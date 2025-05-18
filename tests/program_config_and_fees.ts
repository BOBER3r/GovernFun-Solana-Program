import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CommunityTokenLauncher } from "../target/types/community_token_launcher";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";
import { assert } from "chai";

// Constants for the fee calculation
const FEE_PERCENTAGE = 1;
const FEE_BASIS_POINTS = 100;
const PROTOCOL_FEE_PERCENTAGE = 70;
const STAKING_REWARDS_PERCENTAGE = 30;

// Helper function to calculate fee
const calculateFee = (amount: number): number => {
  return Math.floor(amount * FEE_PERCENTAGE / FEE_BASIS_POINTS);
};

// Helper function to calculate protocol fee (70% of fee)
const calculateProtocolFee = (feeAmount: number): number => {
  return Math.floor(feeAmount * PROTOCOL_FEE_PERCENTAGE / 100);
};

// Helper function to calculate staking reward (30% of fee)
const calculateStakingReward = (feeAmount: number): number => {
  return Math.floor(feeAmount * STAKING_REWARDS_PERCENTAGE / 100);
};

describe("program_config_and_fees", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CommunityTokenLauncher as Program<CommunityTokenLauncher>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  // Key pairs
  const admin = Keypair.generate();
  const tokenCreator = Keypair.generate();
  const user = Keypair.generate();
  const initialFeeCollector = Keypair.generate();
  const newFeeCollector = Keypair.generate();
  const proposer = Keypair.generate();
  const decimals = 9;

  // PDAs
  let programConfig: PublicKey;
  let mint: PublicKey;
  let tokenRegistry: PublicKey;
  let governance: PublicKey;
  let stakingPool: PublicKey;
  let stakingVault: PublicKey;
  let stakingVaultAuthority: PublicKey;
  let stakingRewardsVault: PublicKey;
  let stakingRewardsVaultAuthority: PublicKey;
  let stakerAccount: PublicKey;
  let proposal: PublicKey;

  // Token accounts
  let adminTokenAccount: PublicKey;
  let tokenCreatorTokenAccount: PublicKey;
  let userTokenAccount: PublicKey;
  let initialFeeCollectorTokenAccount: PublicKey;
  let newFeeCollectorTokenAccount: PublicKey;
  let proposerTokenAccount: PublicKey;

  const getPda = async (seeds: Buffer[], programId: PublicKey) => {
    const [pda, bump] = await PublicKey.findProgramAddress(seeds, programId);
    return { pda, bump };
  };

  before(async () => {
    // Request airdrop for all accounts
    for (const kp of [admin, tokenCreator, user, initialFeeCollector, newFeeCollector, proposer]) {
      await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Derive program config PDA
    const programConfigResult = await getPda(
      [Buffer.from("program_config")],
      program.programId
    );
    programConfig = programConfigResult.pda;
    console.log("Program Config PDA:", programConfig.toBase58());

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
    adminTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      admin.publicKey
    );
    console.log("Admin token account:", adminTokenAccount.toBase58());

    tokenCreatorTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      tokenCreator.publicKey
    );
    console.log("Token creator token account:", tokenCreatorTokenAccount.toBase58());

    userTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      user.publicKey
    );
    console.log("User token account:", userTokenAccount.toBase58());

    initialFeeCollectorTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      initialFeeCollector.publicKey
    );
    console.log("Initial fee collector token account:", initialFeeCollectorTokenAccount.toBase58());

    newFeeCollectorTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      newFeeCollector.publicKey
    );
    console.log("New fee collector token account:", newFeeCollectorTokenAccount.toBase58());

    proposerTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      proposer.publicKey
    );
    console.log("Proposer token account:", proposerTokenAccount.toBase58());

    // Mint tokens to accounts
    await mintTo(
      connection,
      wallet.payer,
      mint,
      adminTokenAccount,
      wallet.payer,
      500 * 10 ** decimals
    );

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
      userTokenAccount,
      wallet.payer,
      100 * 10 ** decimals
    );

    await mintTo(
      connection,
      wallet.payer,
      mint,
      proposerTokenAccount,
      wallet.payer,
      200 * 10 ** decimals
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

    // Initialize staking-related PDAs
    const stakingPoolResult = await getPda(
      [Buffer.from("staking_pool"), mint.toBuffer()],
      program.programId
    );
    stakingPool = stakingPoolResult.pda;
    console.log("Staking Pool PDA:", stakingPool.toBase58());

    const stakingVaultAuthorityResult = await getPda(
      [Buffer.from("staking_vault_authority"), mint.toBuffer()],
      program.programId
    );
    stakingVaultAuthority = stakingVaultAuthorityResult.pda;
    console.log("Staking Vault Authority PDA:", stakingVaultAuthority.toBase58());

    const stakingVaultResult = await getPda(
      [Buffer.from("staking_vault"), mint.toBuffer()],
      program.programId
    );
    stakingVault = stakingVaultResult.pda;
    console.log("Staking Vault PDA:", stakingVault.toBase58());

    const stakingRewardsVaultAuthorityResult = await getPda(
      [Buffer.from("staking_rewards_vault_authority"), mint.toBuffer()],
      program.programId
    );
    stakingRewardsVaultAuthority = stakingRewardsVaultAuthorityResult.pda;
    console.log("Staking Rewards Vault Authority PDA:", stakingRewardsVaultAuthority.toBase58());

    const stakingRewardsVaultResult = await getPda(
      [Buffer.from("staking_rewards_vault"), mint.toBuffer()],
      program.programId
    );
    stakingRewardsVault = stakingRewardsVaultResult.pda;
    console.log("Staking Rewards Vault PDA:", stakingRewardsVault.toBase58());
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

    const configAccount = await program.account.programConfig.fetch(programConfig);
    assert.ok(configAccount.admin.equals(admin.publicKey));
    assert.ok(configAccount.feeCollector.equals(initialFeeCollector.publicKey));

    console.log("Program config initialized successfully!");
  });

  it("Prevents non-first caller from initializing program config", async () => {
    console.log("Testing duplicate initialization prevention...");

    try {
      await program.methods
        .initializeProgramConfig(initialFeeCollector.publicKey)
        .accounts({
          admin: user.publicKey,
          programConfig,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();
      assert.fail("Should not allow duplicate initialization");
    } catch (error) {
      console.log("Prevented duplicate initialization as expected");
    }
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

    const configAccount = await program.account.programConfig.fetch(programConfig);
    assert.ok(configAccount.feeCollector.equals(newFeeCollector.publicKey));

    console.log("Fee collector updated successfully!");
  });

  it("Prevents non-admin from updating fee collector", async () => {
    console.log("Testing non-admin update prevention...");

    try {
      await program.methods
        .updateFeeCollector(initialFeeCollector.publicKey)
        .accounts({
          admin: user.publicKey,
          programConfig,
        })
        .signers([user])
        .rpc();
      assert.fail("Should not allow non-admin to update fee collector");
    } catch (error) {
      console.log("Prevented non-admin update as expected");
    }
  });

  it("Registers community token with fee collection", async () => {
    console.log("Registering community token with updated fee collector...");
    const launchTimestamp = new anchor.BN(Math.floor(Date.now() / 1000));
    const registrationFee = 10 * 10 ** decimals;
    const expectedFee = calculateFee(registrationFee);

    // Get balance before registration
    const feeCollectorBalanceBefore = await getAccount(connection, newFeeCollectorTokenAccount);
    console.log("Fee collector balance before:", Number(feeCollectorBalanceBefore.amount));

    await program.methods
      .registerCommunityToken(
        "Fee Test Token",
        "FTT",
        launchTimestamp,
        "fee_test_id_123",
        true,
        new anchor.BN(registrationFee)
      )
      .accounts({
        authority: tokenCreator.publicKey,
        tokenRegistry,
        tokenMint: mint,
        feeCollector: newFeeCollector.publicKey,
        authorityTokenAccount: tokenCreatorTokenAccount,
        feeCollectorTokenAccount: newFeeCollectorTokenAccount,
        programConfig,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([tokenCreator])
      .rpc();

    // Verify fee collection
    const feeCollectorBalanceAfter = await getAccount(connection, newFeeCollectorTokenAccount);
    console.log("Fee collector balance after:", Number(feeCollectorBalanceAfter.amount));
    
    const feeDifference = Number(feeCollectorBalanceAfter.amount) - Number(feeCollectorBalanceBefore.amount);
    console.log("Fee collected:", feeDifference);
    
    // All fee should go to fee collector since staking not initialized yet
    assert.equal(feeDifference, expectedFee);

    console.log("Token registered successfully with fees collected!");
  });

  it("Initializes staking pool for fee distribution", async () => {
    console.log("Initializing staking pool...");
    const distributionInterval = 604800; // 1 week in seconds

    await program.methods
      .initializeStakingPool(
        new anchor.BN(distributionInterval)
      )
      .accounts({
        authority: tokenCreator.publicKey,
        tokenRegistry,
        stakingPool,
        vaultAuthority: stakingVaultAuthority,
        stakingVault,
        rewardsVaultAuthority: stakingRewardsVaultAuthority,
        stakingRewardsVault,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([tokenCreator])
      .rpc();

    console.log("Staking pool initialized successfully!");
  });

  it("Initializes governance with fee split between protocol and staking", async () => {
    console.log("Initializing governance with fee splitting...");
    const governanceFee = 20 * 10 ** decimals;
    const expectedTotalFee = calculateFee(governanceFee);
    const expectedProtocolFee = calculateProtocolFee(expectedTotalFee);
    const expectedStakingReward = calculateStakingReward(expectedTotalFee);
    const proposalThresholdPercentage = 5;

    // Get balances before
    const feeCollectorBalanceBefore = await getAccount(connection, newFeeCollectorTokenAccount);
    console.log("Fee collector balance before:", Number(feeCollectorBalanceBefore.amount));
    
    try {
      const stakingRewardsBalanceBefore = await getAccount(connection, stakingRewardsVault);
      console.log("Staking rewards balance before:", Number(stakingRewardsBalanceBefore.amount));
    } catch (error) {
      console.log("Staking rewards vault not initialized yet");
    }

    await program.methods
      .initializeGovernance(
        new anchor.BN(1), // 1 day voting period for testing
        new anchor.BN(50 * 10 ** decimals), // min vote threshold
        new anchor.BN(100 * 10 ** decimals), // proposal threshold
        proposalThresholdPercentage,
        "Fee Split Governance",
        new anchor.BN(governanceFee)
      )
      .accounts({
        authority: tokenCreator.publicKey,
        tokenRegistry,
        governance,
        feeCollector: newFeeCollector.publicKey,
        authorityTokenAccount: tokenCreatorTokenAccount,
        feeCollectorTokenAccount: newFeeCollectorTokenAccount,
        stakingPool,
        stakingRewardsVault,
        programConfig,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([tokenCreator])
      .rpc();

    // Verify fee splitting
    const feeCollectorBalanceAfter = await getAccount(connection, newFeeCollectorTokenAccount);
    console.log("Fee collector balance after:", Number(feeCollectorBalanceAfter.amount));
    
    const stakingRewardsBalanceAfter = await getAccount(connection, stakingRewardsVault);
    console.log("Staking rewards balance after:", Number(stakingRewardsBalanceAfter.amount));
    
    const protocolFeeDifference = Number(feeCollectorBalanceAfter.amount) - Number(feeCollectorBalanceBefore.amount);
    console.log("Protocol fee collected:", protocolFeeDifference);
    
    // Staking rewards vault is new, so its balance should be the staking reward
    const stakingRewardCollected = Number(stakingRewardsBalanceAfter.amount);
    console.log("Staking reward collected:", stakingRewardCollected);
    
    assert.equal(protocolFeeDifference, expectedProtocolFee);
    assert.equal(stakingRewardCollected, expectedStakingReward);

    console.log("Governance initialized with correct fee splitting!");
  });

  it("Creates a proposal with fee splitting", async () => {
    console.log("Creating proposal with fee splitting...");
    
    // Get the proposal PDA
    const proposalResult = await getPda(
      [
        Buffer.from("proposal"),
        governance.toBuffer(),
        new anchor.BN(0).toBuffer("le", 8),
      ],
      program.programId
    );
    proposal = proposalResult.pda;
    console.log("Proposal PDA:", proposal.toBase58());

    // Define proposal fee
    const proposalFee = 5 * 10 ** decimals;
    const expectedTotalFee = calculateFee(proposalFee);
    const expectedProtocolFee = calculateProtocolFee(expectedTotalFee);
    const expectedStakingReward = calculateStakingReward(expectedTotalFee);

    // Get balances before
    const feeCollectorBalanceBefore = await getAccount(connection, newFeeCollectorTokenAccount);
    console.log("Fee collector balance before:", Number(feeCollectorBalanceBefore.amount));
    
    const stakingRewardsBalanceBefore = await getAccount(connection, stakingRewardsVault);
    console.log("Staking rewards balance before:", Number(stakingRewardsBalanceBefore.amount));

    const choices = ["Option A", "Option B", "Option C"];
    await program.methods
      .createMultiChoiceProposal(
        "Fee Split Proposal",
        "Testing fee splitting on proposal creation",
        choices,
        { updateSettings: {} },
        Buffer.from([]),
        new anchor.BN(proposalFee)
      )
      .accounts({
        proposer: proposer.publicKey,
        governance,
        tokenRegistry,
        tokenMint: mint,
        proposerTokenAccount,
        proposal,
        feeCollector: newFeeCollector.publicKey,
        feeCollectorTokenAccount: newFeeCollectorTokenAccount,
        programConfig,
        stakingPool,
        stakingRewardsVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([proposer])
      .rpc();

    // Verify fee splitting
    const feeCollectorBalanceAfter = await getAccount(connection, newFeeCollectorTokenAccount);
    console.log("Fee collector balance after:", Number(feeCollectorBalanceAfter.amount));
    
    const stakingRewardsBalanceAfter = await getAccount(connection, stakingRewardsVault);
    console.log("Staking rewards balance after:", Number(stakingRewardsBalanceAfter.amount));
    
    const protocolFeeDifference = Number(feeCollectorBalanceAfter.amount) - Number(feeCollectorBalanceBefore.amount);
    console.log("Protocol fee collected:", protocolFeeDifference);
    
    const stakingRewardDifference = Number(stakingRewardsBalanceAfter.amount) - Number(stakingRewardsBalanceBefore.amount);
    console.log("Staking reward collected:", stakingRewardDifference);
    
    assert.equal(protocolFeeDifference, expectedProtocolFee);
    assert.equal(stakingRewardDifference, expectedStakingReward);

    console.log("Proposal created with correct fee splitting!");
  });

  it("Stakes tokens and sets up staker account", async () => {
    console.log("Staking tokens for user...");

    // Set up staker account PDA
    const stakerAccountResult = await getPda(
      [
        Buffer.from("staker_account"),
        mint.toBuffer(),
        user.publicKey.toBuffer(),
      ],
      program.programId
    );
    stakerAccount = stakerAccountResult.pda;
    console.log("Staker Account PDA:", stakerAccount.toBase58());

    // Get balances before staking
    const userBalanceBefore = await getAccount(connection, userTokenAccount);
    console.log("User balance before staking:", Number(userBalanceBefore.amount));

    // Stake 50 tokens
    const stakeAmount = 50 * 10 ** decimals;

    await program.methods
      .stakeTokens(
        new anchor.BN(stakeAmount)
      )
      .accounts({
        staker: user.publicKey,
        stakingPool,
        stakerAccount,
        stakerTokenAccount: userTokenAccount,
        vaultAuthority: stakingVaultAuthority,
        stakingVault,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    // Verify staking
    const stakerAccountInfo = await program.account.stakerAccount.fetch(stakerAccount);
    assert.equal(Number(stakerAccountInfo.stakedAmount), stakeAmount);
    console.log("Staked amount:", Number(stakerAccountInfo.stakedAmount));

    console.log("Tokens staked successfully!");
  });

  it("Claims rewards from staking pool", async () => {
    console.log("Claiming rewards...");

    // Get rewards balance before claiming
    const stakingRewardsBalanceBefore = await getAccount(connection, stakingRewardsVault);
    console.log("Staking rewards vault balance before:", Number(stakingRewardsBalanceBefore.amount));
    
    const userTokenBalanceBefore = await getAccount(connection, userTokenAccount);
    console.log("User token balance before:", Number(userTokenBalanceBefore.amount));

    // Staker account should have accumulated rewards from fees
    await program.methods
      .claimRewards()
      .accounts({
        staker: user.publicKey,
        stakingPool,
        stakerAccount,
        stakerTokenAccount: userTokenAccount,
        rewardsVaultAuthority: stakingRewardsVaultAuthority,
        stakingRewardsVault,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // Verify rewards were claimed
    const stakingRewardsBalanceAfter = await getAccount(connection, stakingRewardsVault);
    console.log("Staking rewards vault balance after:", Number(stakingRewardsBalanceAfter.amount));
    
    const userTokenBalanceAfter = await getAccount(connection, userTokenAccount);
    console.log("User token balance after:", Number(userTokenBalanceAfter.amount));
    
    const stakingRewardDifference = Number(stakingRewardsBalanceBefore.amount) - Number(stakingRewardsBalanceAfter.amount);
    console.log("Rewards claimed by user:", stakingRewardDifference);
    
    const userBalanceDifference = Number(userTokenBalanceAfter.amount) - Number(userTokenBalanceBefore.amount);
    console.log("User balance increase:", userBalanceDifference);
    
    assert.equal(stakingRewardDifference, userBalanceDifference);
    assert.isAbove(stakingRewardDifference, 0, "User should have claimed rewards");

    console.log("Rewards claimed successfully!");
  });

  it("Manually distributes staking rewards as token creator", async () => {
    console.log("Manually distributing staking rewards...");
    
    // Get balances before distribution
    const tokenCreatorBalanceBefore = await getAccount(connection, tokenCreatorTokenAccount);
    console.log("Token creator balance before:", Number(tokenCreatorBalanceBefore.amount));
    
    const stakingRewardsBalanceBefore = await getAccount(connection, stakingRewardsVault);
    console.log("Staking rewards vault balance before:", Number(stakingRewardsBalanceBefore.amount));
    
    // Distribute 10 tokens to staking rewards
    const distributionAmount = 10 * 10 ** decimals;
    
    await program.methods
      .distributeStakingRewards(
        new anchor.BN(distributionAmount)
      )
      .accounts({
        authority: tokenCreator.publicKey,
        tokenRegistry,
        stakingPool,
        authorityTokenAccount: tokenCreatorTokenAccount,
        stakingRewardsVault,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([tokenCreator])
      .rpc();
    
    // Verify rewards were distributed
    const tokenCreatorBalanceAfter = await getAccount(connection, tokenCreatorTokenAccount);
    console.log("Token creator balance after:", Number(tokenCreatorBalanceAfter.amount));
    
    const stakingRewardsBalanceAfter = await getAccount(connection, stakingRewardsVault);
    console.log("Staking rewards vault balance after:", Number(stakingRewardsBalanceAfter.amount));
    
    const creatorBalanceDifference = Number(tokenCreatorBalanceBefore.amount) - Number(tokenCreatorBalanceAfter.amount);
    console.log("Tokens distributed from creator:", creatorBalanceDifference);
    
    const rewardsBalanceDifference = Number(stakingRewardsBalanceAfter.amount) - Number(stakingRewardsBalanceBefore.amount);
    console.log("Rewards balance increase:", rewardsBalanceDifference);
    
    assert.equal(creatorBalanceDifference, distributionAmount);
    assert.equal(rewardsBalanceDifference, distributionAmount);
    
    // Check that staking pool's reward balance was updated
    const stakingPoolAfter = await program.account.stakingPool.fetch(stakingPool);
    assert.equal(Number(stakingPoolAfter.rewardBalance), Number(stakingRewardsBalanceAfter.amount));
    
    console.log("Manual reward distribution successful!");
  });

  it("Prevents unauthorized users from distributing rewards", async () => {
    console.log("Testing unauthorized reward distribution prevention...");
    
    // Try to distribute rewards as user who is not the token creator
    const distributionAmount = 5 * 10 ** decimals;
    
    try {
      await program.methods
        .distributeStakingRewards(
          new anchor.BN(distributionAmount)
        )
        .accounts({
          authority: user.publicKey,
          tokenRegistry,
          stakingPool,
          authorityTokenAccount: userTokenAccount,
          stakingRewardsVault,
          tokenMint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();
      
      assert.fail("Should not allow unauthorized users to distribute rewards");
    } catch (error) {
      console.log("Prevented unauthorized reward distribution as expected");
    }
  });

  it("Unstakes tokens with automatic reward claiming", async () => {
    console.log("Testing token unstaking with reward claiming...");

    // Wait to meet minimum staking period - in a real test this would be handled differently
    // but for this example, we'll wait a short period
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get balances before unstaking
    const stakingVaultBalanceBefore = await getAccount(connection, stakingVault);
    console.log("Staking vault balance before:", Number(stakingVaultBalanceBefore.amount));
    
    const stakingRewardsBalanceBefore = await getAccount(connection, stakingRewardsVault);
    console.log("Staking rewards vault balance before:", Number(stakingRewardsBalanceBefore.amount));
    
    const userTokenBalanceBefore = await getAccount(connection, userTokenAccount);
    console.log("User token balance before unstaking:", Number(userTokenBalanceBefore.amount));

    // Unstake half of the tokens
    const stakerAccountInfo = await program.account.stakerAccount.fetch(stakerAccount);
    const stakedAmount = Number(stakerAccountInfo.stakedAmount);
    const unstakeAmount = Math.floor(stakedAmount / 2);
    console.log("Amount to unstake:", unstakeAmount);

    await program.methods
      .unstakeTokens(
        new anchor.BN(unstakeAmount)
      )
      .accounts({
        staker: user.publicKey,
        stakingPool,
        stakerAccount,
        stakerTokenAccount: userTokenAccount,
        vaultAuthority: stakingVaultAuthority,
        stakingVault,
        rewardsVaultAuthority: stakingRewardsVaultAuthority,
        stakingRewardsVault,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    // Verify unstaking and reward claim
    const stakingVaultBalanceAfter = await getAccount(connection, stakingVault);
    console.log("Staking vault balance after:", Number(stakingVaultBalanceAfter.amount));
    
    const stakingRewardsBalanceAfter = await getAccount(connection, stakingRewardsVault);
    console.log("Staking rewards vault balance after:", Number(stakingRewardsBalanceAfter.amount));
    
    const userTokenBalanceAfter = await getAccount(connection, userTokenAccount);
    console.log("User token balance after unstaking:", Number(userTokenBalanceAfter.amount));
    
    const stakingVaultDifference = Number(stakingVaultBalanceBefore.amount) - Number(stakingVaultBalanceAfter.amount);
    console.log("Tokens released from staking vault:", stakingVaultDifference);
    
    const stakingRewardsDifference = Number(stakingRewardsBalanceBefore.amount) - Number(stakingRewardsBalanceAfter.amount);
    console.log("Rewards paid during unstaking:", stakingRewardsDifference);
    
    const userBalanceIncrease = Number(userTokenBalanceAfter.amount) - Number(userTokenBalanceBefore.amount);
    console.log("User balance increase total:", userBalanceIncrease);
    
    const expectedBalanceIncrease = unstakeAmount + stakingRewardsDifference;
    console.log("Expected balance increase:", expectedBalanceIncrease);
    
    assert.approximately(userBalanceIncrease, expectedBalanceIncrease, 2);
    
    // Verify staking account has been updated
    const stakerAccountInfoAfter = await program.account.stakerAccount.fetch(stakerAccount);
    console.log("Staked amount after:", Number(stakerAccountInfoAfter.stakedAmount));
    assert.equal(Number(stakerAccountInfoAfter.stakedAmount), stakedAmount - unstakeAmount);

    console.log("Tokens unstaked with rewards claimed successfully!");
  });
});