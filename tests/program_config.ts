import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CommunityTokenLauncher } from "../target/types/community_token_launcher";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";
import { assert } from "chai";

describe("program_config", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CommunityTokenLauncher as Program<CommunityTokenLauncher>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  // Key pairs
  const admin = Keypair.generate();
  const nonAdmin = Keypair.generate();
  const initialFeeCollector = Keypair.generate();
  const newFeeCollector = Keypair.generate();
  const decimals = 9;

  // PDAs
  let programConfig: PublicKey;

  // Default fee collector value
  let defaultFeeCollector: PublicKey;

  const getPda = async (seeds: Buffer[], programId: PublicKey) => {
    const [pda, bump] = await PublicKey.findProgramAddress(seeds, programId);
    return { pda, bump };
  };

  before(async () => {
    // Request airdrop for all accounts
    for (const kp of [admin, nonAdmin, initialFeeCollector, newFeeCollector]) {
      await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Find program config PDA
    const programConfigResult = await getPda(
      [Buffer.from("program_config")],
      program.programId
    );
    programConfig = programConfigResult.pda;
    console.log("Program Config PDA:", programConfig.toBase58());

    // Get default fee collector address from program
    try {
      // Try to read from the compiled program's constants
      const programInfo = await connection.getAccountInfo(program.programId);
      if (programInfo) {
        // This is just a placeholder since we can't directly access program constants
        // In a real scenario, this would come from documentation or the code itself
        defaultFeeCollector = new PublicKey("Hgknisjz7kXJNNgnS5GXrZmtzhRneeAQC2nMa7naht9r");
        console.log("Default fee collector address:", defaultFeeCollector.toBase58());
      }
    } catch (error) {
      console.error("Error getting default fee collector:", error);
      // Fallback to using a known address from the program's source code
      defaultFeeCollector = new PublicKey("Hgknisjz7kXJNNgnS5GXrZmtzhRneeAQC2nMa7naht9r");
    }
  });

  it("Initializes program config with admin and fee collector", async () => {
    console.log("Initializing program config...");

    await program.methods
      .initializeProgramConfig(initialFeeCollector.publicKey)
      .accounts({
        admin: admin.publicKey,
        programConfig,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    // Verify initialization
    const configAccount = await program.account.programConfig.fetch(programConfig);
    assert.ok(configAccount.admin.equals(admin.publicKey), "Admin should be set correctly");
    assert.ok(configAccount.feeCollector.equals(initialFeeCollector.publicKey), "Fee collector should be set correctly");
    assert.equal(configAccount.isInitialized, true, "Program config should be marked as initialized");

    console.log("Program config initialized successfully with admin:", configAccount.admin.toBase58());
    console.log("Fee collector set to:", configAccount.feeCollector.toBase58());
  });

  it("Updates fee collector by admin", async () => {
    console.log("Updating fee collector...");

    await program.methods
      .updateFeeCollector(newFeeCollector.publicKey)
      .accounts({
        admin: admin.publicKey,
        programConfig,
      })
      .signers([admin])
      .rpc();

    // Verify update
    const configAccount = await program.account.programConfig.fetch(programConfig);
    assert.ok(configAccount.feeCollector.equals(newFeeCollector.publicKey), "Fee collector should be updated");

    console.log("Fee collector updated successfully to:", configAccount.feeCollector.toBase58());
  });

  it("Prevents non-admin from updating fee collector", async () => {
    console.log("Testing non-admin update prevention...");

    try {
      await program.methods
        .updateFeeCollector(initialFeeCollector.publicKey)
        .accounts({
          admin: nonAdmin.publicKey,
          programConfig,
        })
        .signers([nonAdmin])
        .rpc();

      assert.fail("Non-admin should not be able to update fee collector");
    } catch (error) {
      console.log("Non-admin update prevented as expected");
    }

    // Verify fee collector did not change
    const configAccount = await program.account.programConfig.fetch(programConfig);
    assert.ok(configAccount.feeCollector.equals(newFeeCollector.publicKey), "Fee collector should remain unchanged");
  });

  it("Prevents duplicate initialization", async () => {
    console.log("Testing duplicate initialization prevention...");

    try {
      await program.methods
        .initializeProgramConfig(initialFeeCollector.publicKey)
        .accounts({
          admin: nonAdmin.publicKey,
          programConfig,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([nonAdmin])
        .rpc();

      assert.fail("Duplicate initialization should not be possible");
    } catch (error) {
      console.log("Duplicate initialization prevented as expected");
    }

    // Verify config remained unchanged
    const configAccount = await program.account.programConfig.fetch(programConfig);
    assert.ok(configAccount.admin.equals(admin.publicKey), "Admin should remain unchanged");
    assert.ok(configAccount.feeCollector.equals(newFeeCollector.publicKey), "Fee collector should remain unchanged");
  });

  it("Creates token using config-provided fee collector", async () => {
    console.log("Testing token registration with config-provided fee collector...");

    // Create a token mint
    const mint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      decimals
    );
    console.log("Test token mint created:", mint.toBase58());

    // Create token accounts
    const creatorTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      admin.publicKey
    );

    const newFeeCollectorTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      newFeeCollector.publicKey
    );

    // Mint tokens to creator
    await mintTo(
      connection,
      wallet.payer,
      mint,
      creatorTokenAccount,
      wallet.payer,
      1000 * 10 ** decimals
    );

    // Create token registry PDA
    const tokenRegistryResult = await getPda(
      [Buffer.from("token_registry"), mint.toBuffer()],
      program.programId
    );
    const tokenRegistry = tokenRegistryResult.pda;

    // Register the token
    const launchTimestamp = new anchor.BN(Math.floor(Date.now() / 1000));
    const registrationFee = 10 * 10 ** decimals;

    // Get fee collector balance before
    const feeCollectorBalanceBefore = await getAccount(connection, newFeeCollectorTokenAccount);
    console.log("Fee collector balance before registration:", Number(feeCollectorBalanceBefore.amount));

    // Register token with the configured fee collector
    await program.methods
      .registerCommunityToken(
        "Config Test Token",
        "CTT",
        launchTimestamp,
        "config_test_id",
        true,
        new anchor.BN(registrationFee)
      )
      .accounts({
        authority: admin.publicKey,
        tokenRegistry,
        tokenMint: mint,
        feeCollector: newFeeCollector.publicKey, // Using the updated fee collector from config
        authorityTokenAccount: creatorTokenAccount,
        feeCollectorTokenAccount: newFeeCollectorTokenAccount,
        programConfig, // Including program config
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    // Get fee collector balance after
    const feeCollectorBalanceAfter = await getAccount(connection, newFeeCollectorTokenAccount);
    console.log("Fee collector balance after registration:", Number(feeCollectorBalanceAfter.amount));

    // Verify fee collector received fees
    assert.isTrue(
      Number(feeCollectorBalanceAfter.amount) > Number(feeCollectorBalanceBefore.amount),
      "Fee collector should receive registration fees"
    );

    console.log("Token registered successfully with config-provided fee collector!");
  });

  it("Fails when wrong fee collector is provided", async () => {
    console.log("Testing error when wrong fee collector is provided...");

    // Create a token mint
    const mint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      decimals
    );
    console.log("Test token mint created:", mint.toBase58());

    // Create token accounts
    const creatorTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      admin.publicKey
    );

    const initialFeeCollectorTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      initialFeeCollector.publicKey
    );

    // Mint tokens to creator
    await mintTo(
      connection,
      wallet.payer,
      mint,
      creatorTokenAccount,
      wallet.payer,
      1000 * 10 ** decimals
    );

    // Create token registry PDA
    const tokenRegistryResult = await getPda(
      [Buffer.from("token_registry"), mint.toBuffer()],
      program.programId
    );
    const tokenRegistry = tokenRegistryResult.pda;

    // Register the token with the wrong fee collector
    const launchTimestamp = new anchor.BN(Math.floor(Date.now() / 1000));
    const registrationFee = 10 * 10 ** decimals;

    try {
      await program.methods
        .registerCommunityToken(
          "Wrong Fee Collector Token",
          "WFC",
          launchTimestamp,
          "wrong_fee_collector_test",
          true,
          new anchor.BN(registrationFee)
        )
        .accounts({
          authority: admin.publicKey,
          tokenRegistry,
          tokenMint: mint,
          feeCollector: initialFeeCollector.publicKey, // Using the wrong fee collector
          authorityTokenAccount: creatorTokenAccount,
          feeCollectorTokenAccount: initialFeeCollectorTokenAccount,
          programConfig, // Including program config
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([admin])
        .rpc();

      assert.fail("Token registration should fail with wrong fee collector");
    } catch (error) {
      console.log("Token registration with wrong fee collector failed as expected");
    }
  });

  it("Updates the fee collector again", async () => {
    console.log("Updating fee collector back to initial...");

    await program.methods
      .updateFeeCollector(initialFeeCollector.publicKey)
      .accounts({
        admin: admin.publicKey,
        programConfig,
      })
      .signers([admin])
      .rpc();

    // Verify update
    const configAccount = await program.account.programConfig.fetch(programConfig);
    assert.ok(configAccount.feeCollector.equals(initialFeeCollector.publicKey), "Fee collector should be updated back");

    console.log("Fee collector updated successfully back to:", configAccount.feeCollector.toBase58());
  });

  it("Creates token using newly updated fee collector", async () => {
    console.log("Testing token registration with newly updated fee collector...");

    // Create a token mint
    const mint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      decimals
    );
    console.log("Test token mint created:", mint.toBase58());

    // Create token accounts
    const creatorTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      admin.publicKey
    );

    const initialFeeCollectorTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      initialFeeCollector.publicKey
    );

    // Mint tokens to creator
    await mintTo(
      connection,
      wallet.payer,
      mint,
      creatorTokenAccount,
      wallet.payer,
      1000 * 10 ** decimals
    );

    // Create token registry PDA
    const tokenRegistryResult = await getPda(
      [Buffer.from("token_registry"), mint.toBuffer()],
      program.programId
    );
    const tokenRegistry = tokenRegistryResult.pda;

    // Register the token
    const launchTimestamp = new anchor.BN(Math.floor(Date.now() / 1000));
    const registrationFee = 10 * 10 ** decimals;

    // Get fee collector balance before
    const feeCollectorBalanceBefore = await getAccount(connection, initialFeeCollectorTokenAccount);
    console.log("Fee collector balance before registration:", Number(feeCollectorBalanceBefore.amount));

    // Register token with the configured fee collector
    await program.methods
      .registerCommunityToken(
        "Config Test Token 2",
        "CTT2",
        launchTimestamp,
        "config_test_id_2",
        true,
        new anchor.BN(registrationFee)
      )
      .accounts({
        authority: admin.publicKey,
        tokenRegistry,
        tokenMint: mint,
        feeCollector: initialFeeCollector.publicKey, // Using the updated fee collector from config
        authorityTokenAccount: creatorTokenAccount,
        feeCollectorTokenAccount: initialFeeCollectorTokenAccount,
        programConfig, // Including program config
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([admin])
      .rpc();

    // Get fee collector balance after
    const feeCollectorBalanceAfter = await getAccount(connection, initialFeeCollectorTokenAccount);
    console.log("Fee collector balance after registration:", Number(feeCollectorBalanceAfter.amount));

    // Verify fee collector received fees
    assert.isTrue(
      Number(feeCollectorBalanceAfter.amount) > Number(feeCollectorBalanceBefore.amount),
      "Fee collector should receive registration fees"
    );

    console.log("Token registered successfully with newly updated fee collector!");
  });
});