use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

declare_id!("BaEYfiiK12ranC3KrMyz3XvLNVUBip3fkt2cGtWw3RG8");

const CONFIG_SEED: &[u8] = b"config";
const AUDITOR_PROFILE_SEED: &[u8] = b"auditor_profile";
const AUDITOR_VAULT_SEED: &[u8] = b"auditor_vault";
const VIEWING_GRANT_SEED: &[u8] = b"viewing_grant";

#[program]
pub mod aegis_audit_registry {
    use super::*;

    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        min_auditor_stake_lamports: u64,
        slash_destination: Pubkey,
    ) -> Result<()> {
        require!(min_auditor_stake_lamports > 0, AuditRegistryError::InvalidStakeAmount);
        require!(slash_destination != Pubkey::default(), AuditRegistryError::InvalidAuthority);

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.slash_destination = slash_destination;
        config.min_auditor_stake_lamports = min_auditor_stake_lamports;
        config.bump = ctx.bumps.config;

        emit!(ProtocolInitialized {
            admin: config.admin,
            min_auditor_stake_lamports,
            slash_destination,
        });

        Ok(())
    }

    pub fn update_protocol_config(
        ctx: Context<UpdateProtocolConfig>,
        new_admin: Pubkey,
        new_min_auditor_stake_lamports: u64,
        new_slash_destination: Pubkey,
    ) -> Result<()> {
        require!(new_min_auditor_stake_lamports > 0, AuditRegistryError::InvalidStakeAmount);
        require!(new_admin != Pubkey::default(), AuditRegistryError::InvalidAuthority);
        require!(new_slash_destination != Pubkey::default(), AuditRegistryError::InvalidAuthority);

        let config = &mut ctx.accounts.config;
        let previous_admin = config.admin;
        let previous_min_auditor_stake_lamports = config.min_auditor_stake_lamports;
        let previous_slash_destination = config.slash_destination;

        config.admin = new_admin;
        config.min_auditor_stake_lamports = new_min_auditor_stake_lamports;
        config.slash_destination = new_slash_destination;

        emit!(ProtocolConfigUpdated {
            updated_by: ctx.accounts.admin.key(),
            previous_admin,
            new_admin,
            previous_min_auditor_stake_lamports,
            new_min_auditor_stake_lamports,
            previous_slash_destination,
            new_slash_destination,
        });

        Ok(())
    }

    pub fn register_auditor(
        ctx: Context<RegisterAuditor>,
        metadata_hash: [u8; 32],
        stake_lamports: u64,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(
            stake_lamports >= config.min_auditor_stake_lamports,
            AuditRegistryError::InsufficientStake
        );

        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.auditor.to_account_info(),
                to: ctx.accounts.auditor_vault.to_account_info(),
            },
        );
        system_program::transfer(transfer_ctx, stake_lamports)?;

        let now = Clock::get()?.unix_timestamp;
        let profile = &mut ctx.accounts.auditor_profile;
        profile.authority = ctx.accounts.auditor.key();
        profile.metadata_hash = metadata_hash;
        profile.stake_locked_lamports = stake_lamports;
        profile.status = AuditorStatus::Pending;
        profile.bump = ctx.bumps.auditor_profile;
        profile.vault_bump = ctx.bumps.auditor_vault;
        profile.registered_at = now;
        profile.approved_at = None;

        let vault = &mut ctx.accounts.auditor_vault;
        vault.authority = ctx.accounts.auditor.key();
        vault.bump = ctx.bumps.auditor_vault;

        emit!(AuditorRegistered {
            auditor: profile.authority,
            stake_locked_lamports: profile.stake_locked_lamports,
            metadata_hash,
        });

        Ok(())
    }

    pub fn approve_auditor(ctx: Context<ApproveAuditor>) -> Result<()> {
        let profile = &mut ctx.accounts.auditor_profile;
        require!(
            profile.status == AuditorStatus::Pending || profile.status == AuditorStatus::Suspended,
            AuditRegistryError::InvalidAuditorStatus
        );
        require!(
            profile.stake_locked_lamports >= ctx.accounts.config.min_auditor_stake_lamports,
            AuditRegistryError::InsufficientStake
        );

        profile.status = AuditorStatus::Approved;
        profile.approved_at = Some(Clock::get()?.unix_timestamp);

        emit!(AuditorApproved {
            auditor: profile.authority,
            approved_by: ctx.accounts.admin.key(),
        });

        Ok(())
    }

    pub fn suspend_auditor(ctx: Context<SuspendAuditor>) -> Result<()> {
        let profile = &mut ctx.accounts.auditor_profile;
        require!(
            profile.status == AuditorStatus::Approved || profile.status == AuditorStatus::Pending,
            AuditRegistryError::InvalidAuditorStatus
        );

        profile.status = AuditorStatus::Suspended;
        profile.approved_at = None;

        emit!(AuditorSuspended {
            auditor: profile.authority,
            suspended_by: ctx.accounts.admin.key(),
        });

        Ok(())
    }

    pub fn top_up_auditor_stake(ctx: Context<TopUpAuditorStake>, amount: u64) -> Result<()> {
        require!(amount > 0, AuditRegistryError::InvalidStakeAmount);

        let transfer_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.auditor.to_account_info(),
                to: ctx.accounts.auditor_vault.to_account_info(),
            },
        );
        system_program::transfer(transfer_ctx, amount)?;

        let profile = &mut ctx.accounts.auditor_profile;
        profile.stake_locked_lamports = profile
            .stake_locked_lamports
            .checked_add(amount)
            .ok_or(AuditRegistryError::MathOverflow)?;

        if profile.status == AuditorStatus::Slashed {
            profile.status = AuditorStatus::Pending;
        }

        emit!(AuditorStakeToppedUp {
            auditor: profile.authority,
            amount,
            total_stake_lamports: profile.stake_locked_lamports,
        });

        Ok(())
    }

    pub fn create_viewing_grant(
        ctx: Context<CreateViewingGrant>,
        scope: GrantScope,
        scope_ref: [u8; 32],
        encrypted_tvk_ref: [u8; 32],
        expires_at: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(expires_at > now, AuditRegistryError::GrantAlreadyExpired);

        let profile = &ctx.accounts.auditor_profile;
        require!(profile.status == AuditorStatus::Approved, AuditRegistryError::AuditorNotApproved);
        require!(
            profile.authority == ctx.accounts.auditor.key(),
            AuditRegistryError::AuditorAuthorityMismatch
        );
        require!(
            ctx.accounts.grantor.key() != ctx.accounts.auditor.key(),
            AuditRegistryError::SelfGrantForbidden
        );
        require!(
            profile.stake_locked_lamports >= ctx.accounts.config.min_auditor_stake_lamports,
            AuditRegistryError::InsufficientStake
        );

        let grant = &mut ctx.accounts.viewing_grant;
        grant.grantor = ctx.accounts.grantor.key();
        grant.auditor = ctx.accounts.auditor.key();
        grant.scope = scope;
        grant.scope_ref = scope_ref;
        grant.encrypted_tvk_ref = encrypted_tvk_ref;
        grant.created_at = now;
        grant.expires_at = expires_at;
        grant.revoked_at = None;
        grant.bump = ctx.bumps.viewing_grant;

        emit!(ViewingGrantCreated {
            grantor: grant.grantor,
            auditor: grant.auditor,
            scope: grant.scope,
            scope_ref,
            encrypted_tvk_ref,
            expires_at,
        });

        Ok(())
    }

    pub fn revoke_viewing_grant(ctx: Context<RevokeViewingGrant>) -> Result<()> {
        let grant = &mut ctx.accounts.viewing_grant;
        require!(grant.revoked_at.is_none(), AuditRegistryError::GrantAlreadyRevoked);
        grant.revoked_at = Some(Clock::get()?.unix_timestamp);

        emit!(ViewingGrantRevoked {
            grantor: grant.grantor,
            auditor: grant.auditor,
            scope_ref: grant.scope_ref,
        });

        Ok(())
    }

    pub fn close_viewing_grant(ctx: Context<CloseViewingGrant>) -> Result<()> {
        let grant = &ctx.accounts.viewing_grant;
        let now = Clock::get()?.unix_timestamp;
        require!(
            grant.revoked_at.is_some() || grant.expires_at <= now,
            AuditRegistryError::GrantStillActive
        );

        emit!(ViewingGrantClosed {
            grantor: grant.grantor,
            auditor: grant.auditor,
            scope_ref: grant.scope_ref,
        });

        Ok(())
    }

    pub fn slash_auditor(ctx: Context<SlashAuditor>, amount: u64) -> Result<()> {
        require!(amount > 0, AuditRegistryError::InvalidStakeAmount);

        let profile = &mut ctx.accounts.auditor_profile;
        let vault_info = ctx.accounts.auditor_vault.to_account_info();
        let slash_destination_info = ctx.accounts.slash_destination.to_account_info();

        let rent_floor = Rent::get()?.minimum_balance(8 + AuditorVault::INIT_SPACE);
        let current_lamports = vault_info.lamports();
        require!(current_lamports > rent_floor, AuditRegistryError::NothingToSlash);

        let slashable = current_lamports.saturating_sub(rent_floor);
        require!(amount <= slashable, AuditRegistryError::InsufficientSlashableBalance);
        require!(amount <= profile.stake_locked_lamports, AuditRegistryError::InsufficientStake);

        **vault_info.try_borrow_mut_lamports()? -= amount;
        **slash_destination_info.try_borrow_mut_lamports()? += amount;

        profile.stake_locked_lamports = profile.stake_locked_lamports.saturating_sub(amount);
        if profile.stake_locked_lamports == 0 {
            profile.status = AuditorStatus::Slashed;
            profile.approved_at = None;
        } else if profile.stake_locked_lamports < ctx.accounts.config.min_auditor_stake_lamports {
            profile.status = AuditorStatus::Suspended;
            profile.approved_at = None;
        }

        emit!(AuditorSlashed {
            auditor: profile.authority,
            amount,
            remaining_stake_lamports: profile.stake_locked_lamports,
        });

        Ok(())
    }

    pub fn withdraw_auditor_stake(ctx: Context<WithdrawAuditorStake>, amount: u64) -> Result<()> {
        require!(amount > 0, AuditRegistryError::InvalidStakeAmount);

        let profile = &mut ctx.accounts.auditor_profile;
        let vault_info = ctx.accounts.auditor_vault.to_account_info();
        let auditor_info = ctx.accounts.auditor.to_account_info();

        let rent_floor = Rent::get()?.minimum_balance(8 + AuditorVault::INIT_SPACE);
        let current_lamports = vault_info.lamports();
        require!(current_lamports > rent_floor, AuditRegistryError::NothingToSlash);

        let withdrawable = current_lamports.saturating_sub(rent_floor);
        require!(amount <= withdrawable, AuditRegistryError::InsufficientSlashableBalance);
        require!(amount <= profile.stake_locked_lamports, AuditRegistryError::InsufficientStake);

        let remaining_stake_lamports = profile.stake_locked_lamports.saturating_sub(amount);
        if profile.status == AuditorStatus::Approved {
            require!(
                remaining_stake_lamports >= ctx.accounts.config.min_auditor_stake_lamports,
                AuditRegistryError::ApprovedAuditorMustRemainStaked
            );
        }

        **vault_info.try_borrow_mut_lamports()? -= amount;
        **auditor_info.try_borrow_mut_lamports()? += amount;

        profile.stake_locked_lamports = remaining_stake_lamports;
        if remaining_stake_lamports == 0 {
            profile.status = AuditorStatus::Pending;
            profile.approved_at = None;
        } else if remaining_stake_lamports < ctx.accounts.config.min_auditor_stake_lamports {
            profile.status = AuditorStatus::Suspended;
            profile.approved_at = None;
        }

        emit!(AuditorStakeWithdrawn {
            auditor: profile.authority,
            amount,
            remaining_stake_lamports,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + ProtocolConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateProtocolConfig<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ AuditRegistryError::Unauthorized
    )]
    pub config: Account<'info, ProtocolConfig>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct RegisterAuditor<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(
        init,
        payer = auditor,
        space = 8 + AuditorProfile::INIT_SPACE,
        seeds = [AUDITOR_PROFILE_SEED, auditor.key().as_ref()],
        bump
    )]
    pub auditor_profile: Account<'info, AuditorProfile>,
    #[account(
        init,
        payer = auditor,
        space = 8 + AuditorVault::INIT_SPACE,
        seeds = [AUDITOR_VAULT_SEED, auditor.key().as_ref()],
        bump
    )]
    pub auditor_vault: Account<'info, AuditorVault>,
    #[account(mut)]
    pub auditor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveAuditor<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ AuditRegistryError::Unauthorized)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [AUDITOR_PROFILE_SEED, auditor_profile.authority.as_ref()], bump = auditor_profile.bump)]
    pub auditor_profile: Account<'info, AuditorProfile>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SuspendAuditor<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ AuditRegistryError::Unauthorized)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [AUDITOR_PROFILE_SEED, auditor_profile.authority.as_ref()], bump = auditor_profile.bump)]
    pub auditor_profile: Account<'info, AuditorProfile>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct TopUpAuditorStake<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [AUDITOR_PROFILE_SEED, auditor.key().as_ref()], bump = auditor_profile.bump)]
    pub auditor_profile: Account<'info, AuditorProfile>,
    #[account(mut, seeds = [AUDITOR_VAULT_SEED, auditor.key().as_ref()], bump = auditor_profile.vault_bump)]
    pub auditor_vault: Account<'info, AuditorVault>,
    #[account(mut)]
    pub auditor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(scope: GrantScope, scope_ref: [u8; 32], encrypted_tvk_ref: [u8; 32], expires_at: i64)]
pub struct CreateViewingGrant<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub grantor: Signer<'info>,
    /// CHECK: auditor does not sign; the registry verifies it against the stored profile.
    pub auditor: UncheckedAccount<'info>,
    #[account(seeds = [AUDITOR_PROFILE_SEED, auditor.key().as_ref()], bump = auditor_profile.bump)]
    pub auditor_profile: Account<'info, AuditorProfile>,
    #[account(
        init,
        payer = grantor,
        space = 8 + ViewingGrant::INIT_SPACE,
        seeds = [VIEWING_GRANT_SEED, grantor.key().as_ref(), auditor.key().as_ref(), scope_ref.as_ref()],
        bump
    )]
    pub viewing_grant: Account<'info, ViewingGrant>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeViewingGrant<'info> {
    #[account(mut)]
    pub grantor: Signer<'info>,
    #[account(
        mut,
        constraint = viewing_grant.grantor == grantor.key() @ AuditRegistryError::Unauthorized
    )]
    pub viewing_grant: Account<'info, ViewingGrant>,
}

#[derive(Accounts)]
pub struct CloseViewingGrant<'info> {
    #[account(mut)]
    pub grantor: Signer<'info>,
    #[account(
        mut,
        close = grantor,
        constraint = viewing_grant.grantor == grantor.key() @ AuditRegistryError::Unauthorized
    )]
    pub viewing_grant: Account<'info, ViewingGrant>,
}

#[derive(Accounts)]
pub struct SlashAuditor<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ AuditRegistryError::Unauthorized)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [AUDITOR_PROFILE_SEED, auditor_profile.authority.as_ref()], bump = auditor_profile.bump)]
    pub auditor_profile: Account<'info, AuditorProfile>,
    #[account(mut, seeds = [AUDITOR_VAULT_SEED, auditor_profile.authority.as_ref()], bump = auditor_profile.vault_bump)]
    pub auditor_vault: Account<'info, AuditorVault>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(address = config.slash_destination @ AuditRegistryError::InvalidSlashDestination)]
    /// CHECK: validated against the config slash destination.
    pub slash_destination: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct WithdrawAuditorStake<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ProtocolConfig>,
    #[account(mut, seeds = [AUDITOR_PROFILE_SEED, auditor.key().as_ref()], bump = auditor_profile.bump)]
    pub auditor_profile: Account<'info, AuditorProfile>,
    #[account(mut, seeds = [AUDITOR_VAULT_SEED, auditor.key().as_ref()], bump = auditor_profile.vault_bump)]
    pub auditor_vault: Account<'info, AuditorVault>,
    #[account(mut)]
    pub auditor: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub slash_destination: Pubkey,
    pub min_auditor_stake_lamports: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AuditorProfile {
    pub authority: Pubkey,
    pub metadata_hash: [u8; 32],
    pub stake_locked_lamports: u64,
    pub status: AuditorStatus,
    pub registered_at: i64,
    pub approved_at: Option<i64>,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AuditorVault {
    pub authority: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ViewingGrant {
    pub grantor: Pubkey,
    pub auditor: Pubkey,
    pub scope: GrantScope,
    pub scope_ref: [u8; 32],
    pub encrypted_tvk_ref: [u8; 32],
    pub created_at: i64,
    pub expires_at: i64,
    pub revoked_at: Option<i64>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AuditorStatus {
    Pending,
    Approved,
    Suspended,
    Slashed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum GrantScope {
    Daily,
    Transaction,
    Custom,
}

#[event]
pub struct ProtocolInitialized {
    pub admin: Pubkey,
    pub min_auditor_stake_lamports: u64,
    pub slash_destination: Pubkey,
}

#[event]
pub struct ProtocolConfigUpdated {
    pub updated_by: Pubkey,
    pub previous_admin: Pubkey,
    pub new_admin: Pubkey,
    pub previous_min_auditor_stake_lamports: u64,
    pub new_min_auditor_stake_lamports: u64,
    pub previous_slash_destination: Pubkey,
    pub new_slash_destination: Pubkey,
}

#[event]
pub struct AuditorRegistered {
    pub auditor: Pubkey,
    pub stake_locked_lamports: u64,
    pub metadata_hash: [u8; 32],
}

#[event]
pub struct AuditorApproved {
    pub auditor: Pubkey,
    pub approved_by: Pubkey,
}

#[event]
pub struct AuditorSuspended {
    pub auditor: Pubkey,
    pub suspended_by: Pubkey,
}

#[event]
pub struct AuditorStakeToppedUp {
    pub auditor: Pubkey,
    pub amount: u64,
    pub total_stake_lamports: u64,
}

#[event]
pub struct ViewingGrantCreated {
    pub grantor: Pubkey,
    pub auditor: Pubkey,
    pub scope: GrantScope,
    pub scope_ref: [u8; 32],
    pub encrypted_tvk_ref: [u8; 32],
    pub expires_at: i64,
}

#[event]
pub struct ViewingGrantRevoked {
    pub grantor: Pubkey,
    pub auditor: Pubkey,
    pub scope_ref: [u8; 32],
}

#[event]
pub struct ViewingGrantClosed {
    pub grantor: Pubkey,
    pub auditor: Pubkey,
    pub scope_ref: [u8; 32],
}

#[event]
pub struct AuditorSlashed {
    pub auditor: Pubkey,
    pub amount: u64,
    pub remaining_stake_lamports: u64,
}

#[event]
pub struct AuditorStakeWithdrawn {
    pub auditor: Pubkey,
    pub amount: u64,
    pub remaining_stake_lamports: u64,
}

#[error_code]
pub enum AuditRegistryError {
    #[msg("Only the configured admin may perform this action.")]
    Unauthorized,
    #[msg("A required authority or destination pubkey is invalid.")]
    InvalidAuthority,
    #[msg("The supplied stake amount is invalid.")]
    InvalidStakeAmount,
    #[msg("Auditor stake does not meet the minimum requirement.")]
    InsufficientStake,
    #[msg("Auditor status does not allow this operation.")]
    InvalidAuditorStatus,
    #[msg("Only approved auditors may receive viewing grants.")]
    AuditorNotApproved,
    #[msg("The provided auditor account does not match the registered authority.")]
    AuditorAuthorityMismatch,
    #[msg("A grantor cannot assign a viewing grant to the same wallet.")]
    SelfGrantForbidden,
    #[msg("The viewing grant expiry must be in the future.")]
    GrantAlreadyExpired,
    #[msg("The viewing grant has already been revoked.")]
    GrantAlreadyRevoked,
    #[msg("The viewing grant is still active and cannot be closed yet.")]
    GrantStillActive,
    #[msg("The configured slash destination does not match the provided account.")]
    InvalidSlashDestination,
    #[msg("No slashable stake is available in the auditor vault.")]
    NothingToSlash,
    #[msg("Requested slash amount exceeds slashable balance.")]
    InsufficientSlashableBalance,
    #[msg("An approved auditor must remain staked at or above the configured minimum.")]
    ApprovedAuditorMustRemainStaked,
    #[msg("A math overflow occurred while updating stake.")]
    MathOverflow,
}