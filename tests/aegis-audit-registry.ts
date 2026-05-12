import * as anchor from '@coral-xyz/anchor';
import { expect } from 'chai';
import { createHash } from 'crypto';

describe('aegis-audit-registry', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AegisAuditRegistry as anchor.Program;
  const accounts = program.account as any;
  const { SystemProgram, Keypair, LAMPORTS_PER_SOL, PublicKey } = anchor.web3;
  type Web3PublicKey = anchor.web3.PublicKey;
  const MIN_STAKE_LAMPORTS = 1_000_000_000;

  const configPda = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    program.programId,
  )[0];

  const profilePdaFor = (authority: Web3PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('auditor_profile'), authority.toBuffer()],
      program.programId,
    )[0];

  const vaultPdaFor = (authority: Web3PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('auditor_vault'), authority.toBuffer()],
      program.programId,
    )[0];

  const grantPdaFor = (grantor: Web3PublicKey, auditor: Web3PublicKey, scopeRef: Buffer) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from('viewing_grant'), grantor.toBuffer(), auditor.toBuffer(), scopeRef],
      program.programId,
    )[0];

  const hash32 = (value: string) => createHash('sha256').update(value).digest();
  const toFixedArray = (value: Buffer) => Array.from(value.subarray(0, 32));
  const confirmAirdrop = async (pubkey: Web3PublicKey, lamports: number) => {
    const signature = await provider.connection.requestAirdrop(pubkey, lamports);
    const latest = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  };

  const expectFailure = async (cb: () => Promise<unknown>, expectedMessage: string) => {
    try {
      await cb();
      throw new Error(`Expected failure containing: ${expectedMessage}`);
    } catch (error) {
      expect(String(error)).to.contain(expectedMessage);
    }
  };

  it('loads the Anchor workspace program', async () => {
    expect(program).to.exist;
    expect(program.programId.toBase58()).to.equal('BaEYfiiK12ranC3KrMyz3XvLNVUBip3fkt2cGtWw3RG8');
  });

  it('initializes and updates protocol config', async () => {
    const slashDestination = Keypair.generate().publicKey;
    await program.methods
      .initializeProtocol(new anchor.BN(MIN_STAKE_LAMPORTS), slashDestination)
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    let config = await accounts.protocolConfig.fetch(configPda);
    expect(config.admin.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
    expect(config.minAuditorStakeLamports.toNumber()).to.equal(MIN_STAKE_LAMPORTS);
    expect(config.slashDestination.toBase58()).to.equal(slashDestination.toBase58());

    const updatedSlashDestination = Keypair.generate().publicKey;
    const updatedMinStake = MIN_STAKE_LAMPORTS + 200_000_000;
    await program.methods
      .updateProtocolConfig(
        provider.wallet.publicKey,
        new anchor.BN(updatedMinStake),
        updatedSlashDestination,
      )
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
      })
      .rpc();

    config = await accounts.protocolConfig.fetch(configPda);
    expect(config.minAuditorStakeLamports.toNumber()).to.equal(updatedMinStake);
    expect(config.slashDestination.toBase58()).to.equal(updatedSlashDestination.toBase58());
  });

  it('runs the auditor lifecycle from registration through grant closure', async () => {
    const config = await accounts.protocolConfig.fetch(configPda);
    const minStake = config.minAuditorStakeLamports.toNumber();
    const auditor = Keypair.generate();
    const grantor = Keypair.generate();
    const profilePda = profilePdaFor(auditor.publicKey);
    const vaultPda = vaultPdaFor(auditor.publicKey);
    const metadataHash = toFixedArray(hash32('auditor-kyc:v1'));
    const scopeRef = hash32('scope:2026-05-11');
    const grantPda = grantPdaFor(grantor.publicKey, auditor.publicKey, scopeRef);
    const slashAmount = 300_000_000;
    const topUpAmount = 350_000_000;
    const approvedWithdrawal = 50_000_000;

    await confirmAirdrop(auditor.publicKey, 3 * LAMPORTS_PER_SOL);
    await confirmAirdrop(grantor.publicKey, 2 * LAMPORTS_PER_SOL);

    await program.methods
      .registerAuditor(metadataHash, new anchor.BN(minStake + 200_000_000))
      .accounts({
        config: configPda,
        auditorProfile: profilePda,
        auditorVault: vaultPda,
        auditor: auditor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([auditor])
      .rpc();

    await program.methods
      .approveAuditor()
      .accounts({
        config: configPda,
        auditorProfile: profilePda,
        admin: provider.wallet.publicKey,
      })
      .rpc();

    await expectFailure(
      () => program.methods
        .withdrawAuditorStake(new anchor.BN(minStake + 200_000_000))
        .accounts({
          config: configPda,
          auditorProfile: profilePda,
          auditorVault: vaultPda,
          auditor: auditor.publicKey,
        })
        .signers([auditor])
        .rpc(),
      'Approved auditor must remain staked',
    );

    await program.methods
      .createViewingGrant(
        { daily: {} },
        toFixedArray(scopeRef),
        toFixedArray(hash32('encrypted-tvk-ref:v1')),
        new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      )
      .accounts({
        config: configPda,
        grantor: grantor.publicKey,
        auditor: auditor.publicKey,
        auditorProfile: profilePda,
        viewingGrant: grantPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([grantor])
      .rpc();

    const grant = await accounts.viewingGrant.fetch(grantPda);
    expect(grant.grantor.toBase58()).to.equal(grantor.publicKey.toBase58());
    expect(grant.auditor.toBase58()).to.equal(auditor.publicKey.toBase58());

    await program.methods
      .revokeViewingGrant()
      .accounts({
        grantor: grantor.publicKey,
        viewingGrant: grantPda,
      })
      .signers([grantor])
      .rpc();

    const revokedGrant = await accounts.viewingGrant.fetch(grantPda);
    expect(revokedGrant.revokedAt).to.not.equal(null);

    await program.methods
      .closeViewingGrant()
      .accounts({
        grantor: grantor.publicKey,
        viewingGrant: grantPda,
      })
      .signers([grantor])
      .rpc();

    await expectFailure(
      () => accounts.viewingGrant.fetch(grantPda),
      'Account does not exist',
    );

    await program.methods
      .slashAuditor(new anchor.BN(slashAmount))
      .accounts({
        config: configPda,
        auditorProfile: profilePda,
        auditorVault: vaultPda,
        admin: provider.wallet.publicKey,
        slashDestination: config.slashDestination,
      })
      .rpc();

    let profile = await accounts.auditorProfile.fetch(profilePda);
    expect(profile.status).to.have.property('suspended');

    await program.methods
      .topUpAuditorStake(new anchor.BN(topUpAmount))
      .accounts({
        config: configPda,
        auditorProfile: profilePda,
        auditorVault: vaultPda,
        auditor: auditor.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([auditor])
      .rpc();

    await program.methods
      .approveAuditor()
      .accounts({
        config: configPda,
        auditorProfile: profilePda,
        admin: provider.wallet.publicKey,
      })
      .rpc();

    await program.methods
      .withdrawAuditorStake(new anchor.BN(approvedWithdrawal))
      .accounts({
        config: configPda,
        auditorProfile: profilePda,
        auditorVault: vaultPda,
        auditor: auditor.publicKey,
      })
      .signers([auditor])
      .rpc();

    profile = await accounts.auditorProfile.fetch(profilePda);
    expect(profile.status).to.have.property('approved');
    expect(profile.stakeLockedLamports.toNumber()).to.equal(
      minStake + 200_000_000 - slashAmount + topUpAmount - approvedWithdrawal,
    );
  });
});