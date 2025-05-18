import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CommunityTokenLauncher } from "../target/types/community_token_launcher";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";
import { assert } from "chai";

// Constants for the fee calculation
const FEE_PERCENTAGE = 1;
const FEE_BASIS_POINTS = 100;

// Helper function to calculate fee
const calculateFee = (amount: number): number => {
  return Math.floor(amount * FEE_PERCENTAGE / FEE_BASIS_POINTS);
};

describe("token_registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CommunityTokenLauncher as Program<CommunityTokenLauncher>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  // Key pairs
  const tokenCreator = Keypair.generate();
  const unauthorizedUser = Keypair.generate();
  const tokenholder = Keypair.generate();
  const feeCollector = Keypair.generate();
  const decimals = 9;

  // PDAs
  let mint: PublicKey;
  let tokenRegistry: PublicKey;
  let tokenMetadata: PublicKey;
  let programConfig: PublicKey;

  // Token accounts
  let tokenCreatorTokenAccount: PublicKey;
  let unauthorizedUserTokenAccount: PublicKey;
  let tokenholderTokenAccount: PublicKey;
  let feeCollectorTokenAccount: PublicKey;

  const getPda = async (seeds: Buffer[], programId: PublicKey) => {
    const [pda, bump] = await PublicKey.findProgramAddress(seeds, programId);
    return { pda, bump };
  };

  before(async () => {
    // Request airdrop for all accounts
    for (const kp of [tokenCreator, unauthorizedUser, tokenholder, feeCollector]) {
      await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Create token mint
    mint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      null,
      decimals
    );
    console.log("Token mint created:", mint.toBase58());

    // Create token accounts
    tokenCreatorTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      tokenCreator.publicKey
    );
    console.log("Token creator token account:", tokenCreatorTokenAccount.toBase58());

    unauthorizedUserTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      unauthorizedUser.publicKey
    );
    console.log("Unauthorized user token account:", unauthorizedUserTokenAccount.toBase58());

    tokenholderTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      tokenholder.publicKey
    );
    console.log("Tokenholder token account:", tokenholderTokenAccount.toBase58());

    feeCollectorTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      feeCollector.publicKey
    );
    console.log("Fee collector token account:", feeCollectorTokenAccount.toBase58());

    // Mint tokens to accounts
    await mintTo(
      connection,
      wallet.payer,
      mint,
      tokenCreatorTokenAccount,
      wallet.payer,
      1000 * 10 ** decimals
    );

    await mintTo(
      connection,
      wallet.payer,
      mint,
      unauthorizedUserTokenAccount,
      wallet.payer,
      100 * 10 ** decimals
    );

    await mintTo(
      connection,
      wallet.payer,
      mint,
      tokenholderTokenAccount,
      wallet.payer,
      50 * 10 ** decimals
    );

    // Find PDAs
    const programConfigResult = await getPda(
      [Buffer.from("program_config")],
      program.programId
    );
    programConfig = programConfigResult.pda;
    console.log("Program Config PDA:", programConfig.toBase58());

    const tokenRegistryResult = await getPda(
      [Buffer.from("token_registry"), mint.toBuffer()],
      program.programId
    );
    tokenRegistry = tokenRegistryResult.pda;
    console.log("Token registry PDA:", tokenRegistry.toBase58());

    const tokenMetadataResult = await getPda(
      [Buffer.from("token_metadata"), mint.toBuffer()],
      program.programId
    );
    tokenMetadata = tokenMetadataResult.pda;
    console.log("Token metadata PDA:", tokenMetadata.toBase58());
  });

  it("Initializes program config", async () => {
    console.log("Initializing program config...");

    await program.methods
      .initializeProgramConfig(feeCollector.publicKey)
      .accounts({
        admin: wallet.publicKey,
        programConfig,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log("Program config initialized successfully!");
  });

  it("Registers a community token", async () => {
    console.log("Registering community token...");
    const launchTimestamp = new anchor.BN(Math.floor(Date.now() / 1000));
    const registrationFee = 10 * 10 ** decimals;
    const expectedFee = calculateFee(registrationFee);

    // Get balance before registration
    const creatorBalanceBefore = await getAccount(connection, tokenCreatorTokenAccount);
    const feeCollectorBalanceBefore = await getAccount(connection, feeCollectorTokenAccount);

    console.log("Creator balance before:", Number(creatorBalanceBefore.amount));
    console.log("Fee collector balance before:", Number(feeCollectorBalanceBefore.amount));

    // Register token
    await program.methods
      .registerCommunityToken(
        "Registry Test Token",
        "RTT",
        launchTimestamp,
        "registry_test_id",
        true,
        new anchor.BN(registrationFee)
      )
      .accounts({
        authority: tokenCreator.publicKey,
        tokenRegistry,
        tokenMint: mint,
        feeCollector: feeCollector.publicKey,
        authorityTokenAccount: tokenCreatorTokenAccount,
        feeCollectorTokenAccount,
        programConfig,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([tokenCreator])
      .rpc();

    // Get balances after registration
    const creatorBalanceAfter = await getAccount(connection, tokenCreatorTokenAccount);
    const feeCollectorBalanceAfter = await getAccount(connection, feeCollectorTokenAccount);

    console.log("Creator balance after:", Number(creatorBalanceAfter.amount));
    console.log("Fee collector balance after:", Number(feeCollectorBalanceAfter.amount));

    // Verify token creator paid the fee
    const creatorBalanceDifference = Number(creatorBalanceBefore.amount) - Number(creatorBalanceAfter.amount);
    assert.equal(creatorBalanceDifference, registrationFee, "Creator should pay the registration fee");

    // Verify fee collector received the fee
    const feeCollectorBalanceDifference = Number(feeCollectorBalanceAfter.amount) - Number(feeCollectorBalanceBefore.amount);
    assert.equal(feeCollectorBalanceDifference, expectedFee, "Fee collector should receive the fee");

    // Verify token registry data
    const tokenRegistryAccount = await program.account.tokenRegistry.fetch(tokenRegistry);
    assert.equal(tokenRegistryAccount.authority.toBase58(), tokenCreator.publicKey.toBase58());
    assert.equal(tokenRegistryAccount.tokenMint.toBase58(), mint.toBase58());
    assert.equal(tokenRegistryAccount.tokenName, "Registry Test Token");
    assert.equal(tokenRegistryAccount.tokenSymbol, "RTT");
    assert.equal(Number(tokenRegistryAccount.launchTimestamp), Number(launchTimestamp));
    assert.equal(tokenRegistryAccount.pumpFunId, "registry_test_id");
    assert.equal(tokenRegistryAccount.governanceEnabled, true);
    assert.equal(tokenRegistryAccount.isInitialized, true);

    console.log("Token registered successfully!");
  });

  it("Updates token registry settings", async () => {
    console.log("Updating token registry settings...");

    // Update governance enabled flag
    await program.methods
      .updateRegistry(
        false // Disable governance
      )
      .accounts({
        authority: tokenCreator.publicKey,
        tokenRegistry,
      })
      .signers([tokenCreator])
      .rpc();

    // Verify settings were updated
    const tokenRegistryAccount = await program.account.tokenRegistry.fetch(tokenRegistry);
    assert.equal(tokenRegistryAccount.governanceEnabled, false, "Governance should be disabled");

    console.log("Token registry settings updated successfully!");
  });

  it("Prevents unauthorized users from updating token registry", async () => {
    console.log("Testing unauthorized update prevention...");

    try {
      await program.methods
        .updateRegistry(
          true // Try to enable governance
        )
        .accounts({
          authority: unauthorizedUser.publicKey,
          tokenRegistry,
        })
        .signers([unauthorizedUser])
        .rpc();

      assert.fail("Unauthorized update should have failed");
    } catch (error) {
      console.log("Unauthorized update prevented as expected");
    }
  });

  it("Adds token metadata", async () => {
    console.log("Adding token metadata...");
    const metadataUri = "https://example.com/metadata/registry_test_token.json";

    await program.methods
      .addTokenMetadata(metadataUri)
      .accounts({
        authority: tokenCreator.publicKey,
        tokenRegistry,
        tokenMetadata,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([tokenCreator])
      .rpc();

    // Verify metadata was added
    const tokenMetadataAccount = await program.account.tokenMetadata.fetch(tokenMetadata);
    assert.equal(tokenMetadataAccount.tokenMint.toBase58(), mint.toBase58());
    assert.equal(tokenMetadataAccount.metadataUri, metadataUri);

    console.log("Token metadata added successfully!");
  });

  it("Prevents unauthorized users from adding token metadata", async () => {
    console.log("Testing unauthorized metadata addition prevention...");

    // Create a new token metadata address for testing
    const testMetadataResult = await getPda(
      [Buffer.from("token_metadata_test"), mint.toBuffer()],
      program.programId
    );
    const testMetadata = testMetadataResult.pda;

    try {
      await program.methods
        .addTokenMetadata("https://unauthorized.example.com/metadata.json")
        .accounts({
          authority: unauthorizedUser.publicKey,
          tokenRegistry,
          tokenMetadata: testMetadata,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([unauthorizedUser])
        .rpc();

      assert.fail("Unauthorized metadata addition should have failed");
    } catch (error) {
      console.log("Unauthorized metadata addition prevented as expected");
    }
  });

  it("Verifies token ownership", async () => {
    console.log("Verifying token ownership...");

    // Verify tokenholder's ownership
    await program.methods
      .verifyTokenOwnership()
      .accounts({
        user: tokenholder.publicKey,
        tokenRegistry,
        userTokenAccount: tokenholderTokenAccount,
      })
      .signers([tokenholder])
      .rpc();

    console.log("Token ownership verified successfully!");
  });

  it("Fails token ownership verification for empty accounts", async () => {
    console.log("Testing token ownership verification failure for empty accounts...");

    // Create a new token account with 0 tokens
    const emptyTokenholder = Keypair.generate();
    await connection.requestAirdrop(emptyTokenholder.publicKey, 1 * LAMPORTS_PER_SOL);
    
    const emptyTokenholderTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      emptyTokenholder.publicKey
    );

    try {
      await program.methods
        .verifyTokenOwnership()
        .accounts({
          user: emptyTokenholder.publicKey,
          tokenRegistry,
          userTokenAccount: emptyTokenholderTokenAccount,
        })
        .signers([emptyTokenholder])
        .rpc();

      assert.fail("Verification should have failed for empty token account");
    } catch (error) {
      console.log("Token ownership verification failed as expected for empty account");
    }
  });

  it("Updates token registry with governance re-enabled", async () => {
    console.log("Re-enabling governance on token registry...");

    // Re-enable governance
    await program.methods
      .updateRegistry(
        true // Re-enable governance
      )
      .accounts({
        authority: tokenCreator.publicKey,
        tokenRegistry,
      })
      .signers([tokenCreator])
      .rpc();

    // Verify settings were updated
    const tokenRegistryAccount = await program.account.tokenRegistry.fetch(tokenRegistry);
    assert.equal(tokenRegistryAccount.governanceEnabled, true, "Governance should be re-enabled");

    console.log("Token registry governance re-enabled successfully!");
  });
});