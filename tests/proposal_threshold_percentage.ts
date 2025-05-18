import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CommunityTokenLauncher } from "../target/types/community_token_launcher";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";
import { assert } from "chai";

describe("proposal_threshold_percentage", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CommunityTokenLauncher as Program<CommunityTokenLauncher>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  // Key pairs
  const tokenCreator = Keypair.generate();
  const userWithEnoughTokens = Keypair.generate();
  const userWithFewTokens = Keypair.generate();
  const feeCollector = Keypair.generate();
  const decimals = 9;

  // PDAs
  let mint: PublicKey;
  let tokenRegistry: PublicKey;
  let governance: PublicKey;
  let proposalAboveThreshold: PublicKey;
  let proposalBelowThreshold: PublicKey;

  // Token accounts
  let tokenCreatorTokenAccount: PublicKey;
  let userWithEnoughTokensAccount: PublicKey;
  let userWithFewTokensAccount: PublicKey;
  let feeCollectorTokenAccount: PublicKey;

  // Test parameters
  const totalSupply = 10000 * 10 ** decimals; // 10,000 tokens total supply
  const proposalThresholdPercentage = 5; // 5% of total supply needed for proposal
  const proposalThresholdAmount = 100 * 10 ** decimals; // 100 tokens absolute minimum

  // Calculated amounts
  const percentageBasedThreshold = Math.floor(totalSupply * proposalThresholdPercentage / 100);
  const effectiveThreshold = Math.max(proposalThresholdAmount, percentageBasedThreshold);
  
  // Test tokens
  const userWithEnoughAmount = Math.floor(effectiveThreshold * 1.2); // 20% more than minimum
  const userWithFewAmount = Math.floor(effectiveThreshold * 0.8); // 20% less than minimum

  const getPda = async (seeds: Buffer[], programId: PublicKey) => {
    const [pda, bump] = await PublicKey.findProgramAddress(seeds, programId);
    return { pda, bump };
  };

  before(async () => {
    // Request airdrop for all accounts
    for (const kp of [tokenCreator, userWithEnoughTokens, userWithFewTokens, feeCollector]) {
      await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("Creating token mint...");
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

    userWithEnoughTokensAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      userWithEnoughTokens.publicKey
    );
    console.log("User with enough tokens account:", userWithEnoughTokensAccount.toBase58());

    userWithFewTokensAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      userWithFewTokens.publicKey
    );
    console.log("User with few tokens account:", userWithFewTokensAccount.toBase58());

    feeCollectorTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      feeCollector.publicKey
    );
    console.log("Fee collector token account:", feeCollectorTokenAccount.toBase58());

    // Mint tokens to accounts with specific amounts
    await mintTo(
      connection,
      wallet.payer,
      mint,
      tokenCreatorTokenAccount,
      wallet.payer,
      totalSupply - userWithEnoughAmount - userWithFewAmount
    );

    await mintTo(
      connection,
      wallet.payer,
      mint,
      userWithEnoughTokensAccount,
      wallet.payer,
      userWithEnoughAmount
    );

    await mintTo(
      connection,
      wallet.payer,
      mint,
      userWithFewTokensAccount,
      wallet.payer,
      userWithFewAmount
    );

    // Find PDAs
    const tokenRegistryResult = await getPda(
      [Buffer.from("token_registry"), mint.toBuffer()],
      program.programId
    );
    tokenRegistry = tokenRegistryResult.pda;
    console.log("Token registry PDA:", tokenRegistry.toBase58());

    const governanceResult = await getPda(
      [Buffer.from("governance"), mint.toBuffer()],
      program.programId
    );
    governance = governanceResult.pda;
    console.log("Governance PDA:", governance.toBase58());

    // Calculate thresholds
    console.log("Test parameters:");
    console.log(`- Total supply: ${totalSupply / 10 ** decimals} tokens`);
    console.log(`- Proposal threshold absolute: ${proposalThresholdAmount / 10 ** decimals} tokens`);
    console.log(`- Proposal threshold percentage: ${proposalThresholdPercentage}%`);
    console.log(`- Percentage-based threshold: ${percentageBasedThreshold / 10 ** decimals} tokens`);
    console.log(`- Effective threshold: ${effectiveThreshold / 10 ** decimals} tokens`);
    console.log(`- User with enough tokens: ${userWithEnoughAmount / 10 ** decimals} tokens`);
    console.log(`- User with few tokens: ${userWithFewAmount / 10 ** decimals} tokens`);
  });

  it("Sets up token registry and governance with percentage threshold", async () => {
    console.log("Registering community token...");
    const launchTimestamp = new anchor.BN(Math.floor(Date.now() / 1000));
    const registrationFee = 10 * 10 ** decimals;

    await program.methods
      .registerCommunityToken(
        "Threshold Test Token",
        "TTT",
        launchTimestamp,
        "threshold_test_id",
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
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([tokenCreator])
      .rpc();

    console.log("Token registered successfully!");

    console.log("Initializing governance with percentage threshold...");
    const governanceFee = 20 * 10 ** decimals;
    const votingPeriodDays = 1; // 1 day for testing, but we'll use a small value to simulate seconds in the test environment

    await program.methods
      .initializeGovernance(
        new anchor.BN(votingPeriodDays),
        new anchor.BN(50 * 10 ** decimals), // min vote threshold
        new anchor.BN(proposalThresholdAmount),
        proposalThresholdPercentage,
        "Percentage Threshold Governance",
        new anchor.BN(governanceFee)
      )
      .accounts({
        authority: tokenCreator.publicKey,
        tokenRegistry,
        governance,
        feeCollector: feeCollector.publicKey,
        authorityTokenAccount: tokenCreatorTokenAccount,
        feeCollectorTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([tokenCreator])
      .rpc();

    console.log("Governance initialized successfully!");

    // Verify the governance settings
    const governanceAccount = await program.account.governance.fetch(governance);
    assert.equal(Number(governanceAccount.proposalThreshold), proposalThresholdAmount);
    assert.equal(governanceAccount.proposalThresholdPercentage, proposalThresholdPercentage);
    console.log("Governance settings verified!");
  });

  it("User with enough tokens can create a proposal", async () => {
    console.log("Creating proposal with user having enough tokens...");

    // Calculate proposal PDA
    const proposalAboveThresholdResult = await getPda(
      [
        Buffer.from("proposal"),
        governance.toBuffer(),
        new anchor.BN(0).toBuffer("le", 8),
      ],
      program.programId
    );
    proposalAboveThreshold = proposalAboveThresholdResult.pda;
    console.log("Proposal PDA:", proposalAboveThreshold.toBase58());

    // Verify token balance meets requirement
    const userTokenAccountInfo = await getAccount(connection, userWithEnoughTokensAccount);
    const userBalance = Number(userTokenAccountInfo.amount);
    console.log("User balance:", userBalance / 10 ** decimals, "tokens");
    assert.isAtLeast(userBalance, effectiveThreshold, "User should have enough tokens to meet the threshold");

    // Create proposal
    const proposalFee = 5 * 10 ** decimals;
    const choices = ["Option A", "Option B", "Option C"];
    
    await program.methods
      .createMultiChoiceProposal(
        "Successful Threshold Test Proposal",
        "This proposal should succeed as the user meets the percentage threshold",
        choices,
        { updateSettings: {} },
        Buffer.from([]),
        new anchor.BN(proposalFee)
      )
      .accounts({
        proposer: userWithEnoughTokens.publicKey,
        governance,
        tokenRegistry,
        tokenMint: mint,
        proposerTokenAccount: userWithEnoughTokensAccount,
        proposal: proposalAboveThreshold,
        feeCollector: feeCollector.publicKey,
        feeCollectorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([userWithEnoughTokens])
      .rpc();

    // Verify proposal created successfully
    const proposalAccount = await program.account.multiChoiceProposal.fetch(proposalAboveThreshold);
    assert.equal(proposalAccount.title, "Successful Threshold Test Proposal");
    assert.equal(proposalAccount.choices.length, 3);
    assert.isDefined(proposalAccount.status.active, "Proposal status should be Active");

    console.log("Proposal created successfully by user with enough tokens!");
  });

  it("User with insufficient tokens cannot create a proposal", async () => {
    console.log("Attempting to create proposal with user having insufficient tokens...");

    // Calculate proposal PDA
    const proposalBelowThresholdResult = await getPda(
      [
        Buffer.from("proposal"),
        governance.toBuffer(),
        new anchor.BN(1).toBuffer("le", 8),
      ],
      program.programId
    );
    proposalBelowThreshold = proposalBelowThresholdResult.pda;
    console.log("Proposal PDA (below threshold):", proposalBelowThreshold.toBase58());

    // Verify token balance is below requirement
    const userTokenAccountInfo = await getAccount(connection, userWithFewTokensAccount);
    const userBalance = Number(userTokenAccountInfo.amount);
    console.log("User balance:", userBalance / 10 ** decimals, "tokens");
    assert.isBelow(userBalance, effectiveThreshold, "User should have insufficient tokens to meet the threshold");

    // Attempt to create proposal and expect it to fail
    const proposalFee = 5 * 10 ** decimals;
    const choices = ["Option X", "Option Y", "Option Z"];
    
    try {
      await program.methods
        .createMultiChoiceProposal(
          "Failed Threshold Test Proposal",
          "This proposal should fail as the user doesn't meet the percentage threshold",
          choices,
          { updateSettings: {} },
          Buffer.from([]),
          new anchor.BN(proposalFee)
        )
        .accounts({
          proposer: userWithFewTokens.publicKey,
          governance,
          tokenRegistry,
          tokenMint: mint,
          proposerTokenAccount: userWithFewTokensAccount,
          proposal: proposalBelowThreshold,
          feeCollector: feeCollector.publicKey,
          feeCollectorTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([userWithFewTokens])
        .rpc();
      
      assert.fail("Proposal creation should have failed due to insufficient tokens");
    } catch (error) {
      console.log("Proposal creation failed as expected due to insufficient tokens");
      console.log("Error:", error.message);
      
      // Verify the error is related to token threshold
      assert.include(
        error.message.toLowerCase(), 
        "threshold", 
        "Error should mention threshold requirement"
      );
    }
  });

  it("Updates governance to higher percentage threshold", async () => {
    console.log("Updating governance with higher percentage threshold...");
    
    // Increase the threshold percentage
    const newThresholdPercentage = 15; // 15% of total supply
    const newPercentageBasedThreshold = Math.floor(totalSupply * newThresholdPercentage / 100);
    
    console.log(`- New proposal threshold percentage: ${newThresholdPercentage}%`);
    console.log(`- New percentage-based threshold: ${newPercentageBasedThreshold / 10 ** decimals} tokens`);
    
    // Update governance settings
    await program.methods
      .updateGovernanceSettings(
        new anchor.BN(120), // increase voting period to 2 minutes
        new anchor.BN(100 * 10 ** decimals), // increase min vote threshold
        new anchor.BN(proposalThresholdAmount), // keep same absolute threshold
        newThresholdPercentage // increase percentage threshold
      )
      .accounts({
        authority: tokenCreator.publicKey,
        governance,
      })
      .signers([tokenCreator])
      .rpc();
    
    // Verify the updated settings
    const governanceAccount = await program.account.governance.fetch(governance);
    assert.equal(Number(governanceAccount.votingPeriod), 120);
    assert.equal(Number(governanceAccount.minVoteThreshold), 100 * 10 ** decimals);
    assert.equal(Number(governanceAccount.proposalThreshold), proposalThresholdAmount);
    assert.equal(governanceAccount.proposalThresholdPercentage, newThresholdPercentage);
    
    console.log("Governance settings updated successfully!");
  });

  it("Previously eligible user now cannot create proposal with higher threshold", async () => {
    console.log("Attempting to create proposal after threshold increase...");

    // Verify token balance is now below the new requirement
    const userTokenAccountInfo = await getAccount(connection, userWithEnoughTokensAccount);
    const userBalance = Number(userTokenAccountInfo.amount);
    const newPercentageBasedThreshold = Math.floor(totalSupply * 15 / 100);
    const newEffectiveThreshold = Math.max(proposalThresholdAmount, newPercentageBasedThreshold);
    
    console.log("User balance:", userBalance / 10 ** decimals, "tokens");
    console.log("New effective threshold:", newEffectiveThreshold / 10 ** decimals, "tokens");
    
    assert.isBelow(userBalance, newEffectiveThreshold, "User should now have insufficient tokens for new threshold");

    // Calculate a new proposal PDA
    const newProposalResult = await getPda(
      [
        Buffer.from("proposal"),
        governance.toBuffer(),
        new anchor.BN(2).toBuffer("le", 8),
      ],
      program.programId
    );
    const newProposal = newProposalResult.pda;
    
    // Attempt to create proposal and expect it to fail
    const proposalFee = 5 * 10 ** decimals;
    const choices = ["New Option A", "New Option B", "New Option C"];
    
    try {
      await program.methods
        .createMultiChoiceProposal(
          "Post-Threshold-Change Proposal",
          "This proposal should fail due to increased threshold",
          choices,
          { updateSettings: {} },
          Buffer.from([]),
          new anchor.BN(proposalFee)
        )
        .accounts({
          proposer: userWithEnoughTokens.publicKey,
          governance,
          tokenRegistry,
          tokenMint: mint,
          proposerTokenAccount: userWithEnoughTokensAccount,
          proposal: newProposal,
          feeCollector: feeCollector.publicKey,
          feeCollectorTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([userWithEnoughTokens])
        .rpc();
      
      assert.fail("Proposal creation should have failed due to increased threshold");
    } catch (error) {
      console.log("Proposal creation failed as expected due to increased threshold");
      console.log("Error:", error.message);
      
      // Verify the error is related to token threshold
      assert.include(
        error.message.toLowerCase(), 
        "threshold", 
        "Error should mention threshold requirement"
      );
    }
  });

  it("Creator with enough tokens can still create a proposal", async () => {
    console.log("Creating proposal with token creator who has enough tokens...");

    // Calculate proposal PDA
    const creatorProposalResult = await getPda(
      [
        Buffer.from("proposal"),
        governance.toBuffer(),
        new anchor.BN(3).toBuffer("le", 8),
      ],
      program.programId
    );
    const creatorProposal = creatorProposalResult.pda;
    console.log("Creator Proposal PDA:", creatorProposal.toBase58());

    // Verify token balance meets requirement
    const creatorTokenAccountInfo = await getAccount(connection, tokenCreatorTokenAccount);
    const creatorBalance = Number(creatorTokenAccountInfo.amount);
    const newPercentageBasedThreshold = Math.floor(totalSupply * 15 / 100);
    const newEffectiveThreshold = Math.max(proposalThresholdAmount, newPercentageBasedThreshold);
    
    console.log("Creator balance:", creatorBalance / 10 ** decimals, "tokens");
    console.log("Required threshold:", newEffectiveThreshold / 10 ** decimals, "tokens");
    assert.isAtLeast(creatorBalance, newEffectiveThreshold, "Creator should have enough tokens to meet the threshold");

    // Create proposal
    const proposalFee = 5 * 10 ** decimals;
    const choices = ["Creator Option A", "Creator Option B", "Creator Option C"];
    
    await program.methods
      .createMultiChoiceProposal(
        "Creator Threshold Test Proposal",
        "This proposal should succeed as the creator has enough tokens",
        choices,
        { updateSettings: {} },
        Buffer.from([]),
        new anchor.BN(proposalFee)
      )
      .accounts({
        proposer: tokenCreator.publicKey,
        governance,
        tokenRegistry,
        tokenMint: mint,
        proposerTokenAccount: tokenCreatorTokenAccount,
        proposal: creatorProposal,
        feeCollector: feeCollector.publicKey,
        feeCollectorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([tokenCreator])
      .rpc();

    // Verify proposal created successfully
    const proposalAccount = await program.account.multiChoiceProposal.fetch(creatorProposal);
    assert.equal(proposalAccount.title, "Creator Threshold Test Proposal");
    assert.equal(proposalAccount.choices.length, 3);
    assert.isDefined(proposalAccount.status.active, "Proposal status should be Active");

    console.log("Proposal created successfully by token creator!");
  });
});