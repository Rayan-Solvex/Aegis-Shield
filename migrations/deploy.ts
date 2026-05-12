import * as anchor from '@coral-xyz/anchor';

const CONFIG_SEED = 'config';
const DEFAULT_MIN_AUDITOR_STAKE_LAMPORTS = 1_000_000_000;

function parseLamportsFromEnv() {
  const lamports = process.env.AEGIS_MIN_AUDITOR_STAKE_LAMPORTS;
  if (lamports) {
    const parsed = Number.parseInt(lamports, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      throw new Error('AEGIS_MIN_AUDITOR_STAKE_LAMPORTS must be a positive integer.');
    }
    return parsed;
  }

  const sol = process.env.AEGIS_MIN_AUDITOR_STAKE_SOL;
  if (sol) {
    const parsed = Number.parseFloat(sol);
    if (Number.isNaN(parsed) || parsed <= 0) {
      throw new Error('AEGIS_MIN_AUDITOR_STAKE_SOL must be a positive number.');
    }
    return Math.round(parsed * anchor.web3.LAMPORTS_PER_SOL);
  }

  return DEFAULT_MIN_AUDITOR_STAKE_LAMPORTS;
}

const deploy = async (provider: anchor.AnchorProvider) => {
  anchor.setProvider(provider);

  const program = anchor.workspace.AegisAuditRegistry as anchor.Program;
  const accounts = program.account as any;
  const [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from(CONFIG_SEED)],
    program.programId,
  );

  const slashDestination = process.env.AEGIS_SLASH_DESTINATION
    ? new anchor.web3.PublicKey(process.env.AEGIS_SLASH_DESTINATION)
    : provider.wallet.publicKey;
  const minAuditorStakeLamports = parseLamportsFromEnv();
  const desiredAdmin = process.env.AEGIS_PROTOCOL_ADMIN
    ? new anchor.web3.PublicKey(process.env.AEGIS_PROTOCOL_ADMIN)
    : provider.wallet.publicKey;

  const existingConfig = await accounts.protocolConfig.fetchNullable(configPda);

  if (!existingConfig) {
    await program.methods
      .initializeProtocol(
        new anchor.BN(minAuditorStakeLamports),
        slashDestination,
      )
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log('Initialized Aegis audit registry config:', configPda.toBase58());
    return;
  }

  const minStakeChanged = existingConfig.minAuditorStakeLamports.toNumber() !== minAuditorStakeLamports;
  const slashDestinationChanged = !existingConfig.slashDestination.equals(slashDestination);
  const adminChanged = !existingConfig.admin.equals(desiredAdmin);

  if (!minStakeChanged && !slashDestinationChanged && !adminChanged) {
    console.log('Aegis audit registry config already matches desired deployment settings.');
    return;
  }

  await program.methods
    .updateProtocolConfig(
      desiredAdmin,
      new anchor.BN(minAuditorStakeLamports),
      slashDestination,
    )
    .accounts({
      config: configPda,
      admin: provider.wallet.publicKey,
    })
    .rpc();

  console.log('Updated Aegis audit registry config:', configPda.toBase58());
};

export default deploy;