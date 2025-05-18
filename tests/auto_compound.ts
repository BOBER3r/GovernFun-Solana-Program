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

describe("auto_compound", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CommunityTokenLauncher as Program<CommunityTokenLauncher>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  // Key pairs
  const tokenCreator = Keypair.generate();
  const stakerWithAutoCompound = Keypair.generate();
  const stakerWithoutAutoCompound = Keypair.generate();
  const feeCollector = Keypair.generate();
  const decimals = 9;

  // PDAs
  let mint: PublicKey;
  let tokenRegistry: PublicKey;
  let governance: PublicKey;
  let stakingPool: PublicKey;
  let stakingVault: PublicKey;
  let stakingVaultAuthority: PublicKey;
  let stakingRewardsVault: PublicKey;
  let stakingRewardsVaultAuthority: PublicKey;
  let stakerWithAutoCompoundAccount: PublicKey;
  let stakerWithoutAutoCompoundAccount: PublicKey;
  let programConfig: PublicKey;

  // Token accounts
  let tokenCreatorTokenAccount: PublicKey;
  let stakerWithAutoCompoundTokenAccount: PublicKey;
  let stakerWithoutAutoCompoundTokenAccount: PublicKey;
  let feeCollectorTokenAccount: PublicKey;

  const getPda = async (seeds: Buffer[], programId: PublicKey) => {
    const [pda, bump] = await PublicKey.findProgramAddress(seeds, programId);
    return { pda, bump };
  };

  before(async () => {
    // Request airdrop for all accounts
    for (const kp of [tokenCreator, stakerWithAutoCompound, stakerWithoutAutoCompound, feeCollector]) {
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

    stakerWithAutoCompoundTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      stakerWithAutoCompound.publicKey
    );
    console.log("Staker with auto-compound token account:", stakerWithAutoCompoundTokenAccount.toBase58());

    stakerWithoutAutoCompoundTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      stakerWithoutAutoCompound.publicKey
    );
    console.log("Staker without auto-compound token account:", stakerWithoutAutoCompoundTokenAccount.toBase58());

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
      stakerWithAutoCompoundTokenAccount,
      wallet.payer,
      500 * 10 ** decimals
    );

    await mintTo(
      connection,
      wallet.payer,
      mint,
      stakerWithoutAutoCompoundTokenAccount,
      wallet.payer,
      500 * 10 ** decimals
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

    // Set up staker accounts PDAs
    const stakerWithAutoCompoundAccountResult = await getPda(
      [
        Buffer.from("staker_account"),
        mint.toBuffer(),
        stakerWithAutoCompound.publicKey.toBuffer(),
      ],
      program.programId
    );
    stakerWithAutoCompoundAccount = stakerWithAutoCompoundAccountResult.pda;
    console.log("Staker with auto-compound account PDA:", stakerWithAutoCompoundAccount.toBase58());

    const stakerWithoutAutoCompoundAccountResult = await getPda(
      [
        Buffer.from("staker_account"),
        mint.toBuffer(),
        stakerWithoutAutoCompound.publicKey.toBuffer(),
      ],
      program.programId
    );
    stakerWithoutAutoCompoundAccount = stakerWithoutAutoCompoundAccountResult.pda;
    console.log("Staker without auto-compound account PDA:", stakerWithoutAutoCompoundAccount.toBase58());
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

  it("Sets up token registry and staking pool", async () => {
    console.log("Registering community token...");
    const launchTimestamp = new anchor.BN(Math.floor(Date.now() / 1000));
    const registrationFee = 10 * 10 ** decimals;

    await program.methods
      .registerCommunityToken(
        "AutoCompound Test Token",
        "ACT",
        launchTimestamp,
        "auto_compound_test_id",
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

    console.log("Token registered successfully!");

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

  it("Sets up stakers with different auto-compound settings", async () => {
    console.log("Setting up stakers with different auto-compound settings...");

    // Stake tokens for the first staker (will enable auto-compound)
    const stakeAmount1 = 200 * 10 ** decimals;
    
    console.log("Staking tokens for the first staker...");
    await program.methods
      .stakeTokens(
        new anchor.BN(stakeAmount1)
      )
      .accounts({
        staker: stakerWithAutoCompound.publicKey,
        stakingPool,
        stakerAccount: stakerWithAutoCompoundAccount,
        stakerTokenAccount: stakerWithAutoCompoundTokenAccount,
        vaultAuthority: stakingVaultAuthority,
        stakingVault,
        stakingRewardsVault,
        programConfig,
        feeCollector: feeCollector.publicKey,
        feeCollectorTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([stakerWithAutoCompound])
      .rpc();

    // Stake tokens for the second staker (will not enable auto-compound)
    const stakeAmount2 = 200 * 10 ** decimals;
    
    console.log("Staking tokens for the second staker...");
    await program.methods
      .stakeTokens(
        new anchor.BN(stakeAmount2)
      )
      .accounts({
        staker: stakerWithoutAutoCompound.publicKey,
        stakingPool,
        stakerAccount: stakerWithoutAutoCompoundAccount,
        stakerTokenAccount: stakerWithoutAutoCompoundTokenAccount,
        vaultAuthority: stakingVaultAuthority,
        stakingVault,
        stakingRewardsVault,
        programConfig,
        feeCollector: feeCollector.publicKey,
        feeCollectorTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([stakerWithoutAutoCompound])
      .rpc();

    // Verify staking accounts were created with auto-compound disabled by default
    const stakerAccount1 = await program.account.stakerAccount.fetch(stakerWithAutoCompoundAccount);
    const stakerAccount2 = await program.account.stakerAccount.fetch(stakerWithoutAutoCompoundAccount);
    
    assert.equal(stakerAccount1.autoCompound, false, "Auto-compound should be disabled by default");
    assert.equal(stakerAccount2.autoCompound, false, "Auto-compound should be disabled by default");
    
    // Enable auto-compound for the first staker
    console.log("Enabling auto-compound for the first staker...");
    await program.methods
      .toggleAutoCompound(true)
      .accounts({
        staker: stakerWithAutoCompound.publicKey,
        stakerAccount: stakerWithAutoCompoundAccount,
        tokenMint: mint,
      })
      .signers([stakerWithAutoCompound])
      .rpc();
    
    // Verify auto-compound was enabled for the first staker
    const updatedStakerAccount1 = await program.account.stakerAccount.fetch(stakerWithAutoCompoundAccount);
    assert.equal(updatedStakerAccount1.autoCompound, true, "Auto-compound should be enabled for the first staker");
    
    console.log("Stakers set up successfully with different auto-compound settings!");
  });

  it("Distributes rewards to staking pool", async () => {
    console.log("Distributing rewards to staking pool...");
    
    // Get initial balances
    const stakingPoolBefore = await program.account.stakingPool.fetch(stakingPool);
    const rewardsVaultBefore = await getAccount(connection, stakingRewardsVault);
    
    console.log("Initial reward balance:", Number(stakingPoolBefore.rewardBalance));
    console.log("Initial rewards vault balance:", Number(rewardsVaultBefore.amount));
    
    // Token creator distributes additional rewards (50 tokens)
    const distributionAmount = 50 * 10 ** decimals;
    
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
    const stakingPoolAfter = await program.account.stakingPool.fetch(stakingPool);
    const rewardsVaultAfter = await getAccount(connection, stakingRewardsVault);
    
    console.log("Updated reward balance:", Number(stakingPoolAfter.rewardBalance));
    console.log("Updated rewards vault balance:", Number(rewardsVaultAfter.amount));
    
    const rewardDifference = Number(stakingPoolAfter.rewardBalance) - Number(stakingPoolBefore.rewardBalance);
    assert.equal(rewardDifference, distributionAmount, "Reward balance should increase by distribution amount");
    
    console.log("Rewards distributed successfully!");
  });

  it("Claims rewards with different auto-compound settings", async () => {
    console.log("Claiming rewards with different auto-compound settings...");
    
    // Wait for a short period to simulate reward accumulation
    console.log("Waiting to simulate reward accumulation...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get balances before claiming for first staker (auto-compound enabled)
    const stakerAccount1Before = await program.account.stakerAccount.fetch(stakerWithAutoCompoundAccount);
    const stakerTokenAccount1Before = await getAccount(connection, stakerWithAutoCompoundTokenAccount);
    
    console.log("First staker (auto-compound) staked amount before:", Number(stakerAccount1Before.stakedAmount));
    console.log("First staker token balance before:", Number(stakerTokenAccount1Before.amount));
    
    // Claim rewards for first staker (with auto-compound)
    console.log("Claiming rewards for first staker (with auto-compound)...");
    await program.methods
      .claimRewards()
      .accounts({
        staker: stakerWithAutoCompound.publicKey,
        stakingPool,
        stakerAccount: stakerWithAutoCompoundAccount,
        stakerTokenAccount: stakerWithAutoCompoundTokenAccount,
        rewardsVaultAuthority: stakingRewardsVaultAuthority,
        stakingRewardsVault,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([stakerWithAutoCompound])
      .rpc();
    
    // Get balances after claiming for first staker
    const stakerAccount1After = await program.account.stakerAccount.fetch(stakerWithAutoCompoundAccount);
    const stakerTokenAccount1After = await getAccount(connection, stakerWithAutoCompoundTokenAccount);
    
    console.log("First staker (auto-compound) staked amount after:", Number(stakerAccount1After.stakedAmount));
    console.log("First staker token balance after:", Number(stakerTokenAccount1After.amount));
    
    // Verify rewards were auto-compounded (staked amount increased, token balance unchanged)
    assert.isTrue(
      Number(stakerAccount1After.stakedAmount) > Number(stakerAccount1Before.stakedAmount),
      "Staked amount should increase with auto-compound"
    );
    assert.approximately(
      Number(stakerTokenAccount1After.amount),
      Number(stakerTokenAccount1Before.amount),
      10, // Allow small rounding differences
      "Token balance should remain unchanged with auto-compound"
    );
    
    // Get balances before claiming for second staker (auto-compound disabled)
    const stakerAccount2Before = await program.account.stakerAccount.fetch(stakerWithoutAutoCompoundAccount);
    const stakerTokenAccount2Before = await getAccount(connection, stakerWithoutAutoCompoundTokenAccount);
    
    console.log("Second staker (no auto-compound) staked amount before:", Number(stakerAccount2Before.stakedAmount));
    console.log("Second staker token balance before:", Number(stakerTokenAccount2Before.amount));
    
    // Claim rewards for second staker (without auto-compound)
    console.log("Claiming rewards for second staker (without auto-compound)...");
    await program.methods
      .claimRewards()
      .accounts({
        staker: stakerWithoutAutoCompound.publicKey,
        stakingPool,
        stakerAccount: stakerWithoutAutoCompoundAccount,
        stakerTokenAccount: stakerWithoutAutoCompoundTokenAccount,
        rewardsVaultAuthority: stakingRewardsVaultAuthority,
        stakingRewardsVault,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([stakerWithoutAutoCompound])
      .rpc();
    
    // Get balances after claiming for second staker
    const stakerAccount2After = await program.account.stakerAccount.fetch(stakerWithoutAutoCompoundAccount);
    const stakerTokenAccount2After = await getAccount(connection, stakerWithoutAutoCompoundTokenAccount);
    
    console.log("Second staker (no auto-compound) staked amount after:", Number(stakerAccount2After.stakedAmount));
    console.log("Second staker token balance after:", Number(stakerTokenAccount2After.amount));
    
    // Verify rewards were not auto-compounded (staked amount unchanged, token balance increased)
    assert.approximately(
      Number(stakerAccount2After.stakedAmount),
      Number(stakerAccount2Before.stakedAmount),
      10, // Allow small rounding differences
      "Staked amount should remain unchanged without auto-compound"
    );
    assert.isTrue(
      Number(stakerTokenAccount2After.amount) > Number(stakerTokenAccount2Before.amount),
      "Token balance should increase without auto-compound"
    );
    
    console.log("Both stakers claimed rewards successfully with different auto-compound behavior!");
  });

  it("Toggles auto-compound setting", async () => {
    console.log("Testing auto-compound toggle...");
    
    // Disable auto-compound for the first staker
    console.log("Disabling auto-compound for the first staker...");
    await program.methods
      .toggleAutoCompound(false)
      .accounts({
        staker: stakerWithAutoCompound.publicKey,
        stakerAccount: stakerWithAutoCompoundAccount,
        tokenMint: mint,
      })
      .signers([stakerWithAutoCompound])
      .rpc();
    
    // Verify auto-compound was disabled
    const stakerAccount1Updated = await program.account.stakerAccount.fetch(stakerWithAutoCompoundAccount);
    assert.equal(stakerAccount1Updated.autoCompound, false, "Auto-compound should be disabled after toggle");
    
    // Enable auto-compound for the second staker
    console.log("Enabling auto-compound for the second staker...");
    await program.methods
      .toggleAutoCompound(true)
      .accounts({
        staker: stakerWithoutAutoCompound.publicKey,
        stakerAccount: stakerWithoutAutoCompoundAccount,
        tokenMint: mint,
      })
      .signers([stakerWithoutAutoCompound])
      .rpc();
    
    // Verify auto-compound was enabled
    const stakerAccount2Updated = await program.account.stakerAccount.fetch(stakerWithoutAutoCompoundAccount);
    assert.equal(stakerAccount2Updated.autoCompound, true, "Auto-compound should be enabled after toggle");
    
    console.log("Auto-compound settings successfully toggled for both stakers!");
  });

  it("Verifies reversed auto-compound behavior after toggle", async () => {
    console.log("Verifying reversed auto-compound behavior after toggle...");
    
    // Distribute more rewards to the staking pool
    console.log("Distributing more rewards...");
    const distributionAmount = 50 * 10 ** decimals;
    
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
    
    // Wait for a short period to simulate reward accumulation
    console.log("Waiting to simulate reward accumulation...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get balances before claiming for first staker (now with auto-compound disabled)
    const stakerAccount1Before = await program.account.stakerAccount.fetch(stakerWithAutoCompoundAccount);
    const stakerTokenAccount1Before = await getAccount(connection, stakerWithAutoCompoundTokenAccount);
    
    console.log("First staker (auto-compound now disabled) staked amount before:", Number(stakerAccount1Before.stakedAmount));
    console.log("First staker token balance before:", Number(stakerTokenAccount1Before.amount));
    
    // Claim rewards for first staker (now without auto-compound)
    console.log("Claiming rewards for first staker (now without auto-compound)...");
    await program.methods
      .claimRewards()
      .accounts({
        staker: stakerWithAutoCompound.publicKey,
        stakingPool,
        stakerAccount: stakerWithAutoCompoundAccount,
        stakerTokenAccount: stakerWithAutoCompoundTokenAccount,
        rewardsVaultAuthority: stakingRewardsVaultAuthority,
        stakingRewardsVault,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([stakerWithAutoCompound])
      .rpc();
    
    // Get balances after claiming for first staker
    const stakerAccount1After = await program.account.stakerAccount.fetch(stakerWithAutoCompoundAccount);
    const stakerTokenAccount1After = await getAccount(connection, stakerWithAutoCompoundTokenAccount);
    
    console.log("First staker (auto-compound now disabled) staked amount after:", Number(stakerAccount1After.stakedAmount));
    console.log("First staker token balance after:", Number(stakerTokenAccount1After.amount));
    
    // Verify rewards were NOT auto-compounded after disabling
    assert.approximately(
      Number(stakerAccount1After.stakedAmount),
      Number(stakerAccount1Before.stakedAmount),
      10, // Allow small rounding differences
      "Staked amount should remain unchanged after disabling auto-compound"
    );
    assert.isTrue(
      Number(stakerTokenAccount1After.amount) > Number(stakerTokenAccount1Before.amount),
      "Token balance should increase after disabling auto-compound"
    );
    
    // Get balances before claiming for second staker (now with auto-compound enabled)
    const stakerAccount2Before = await program.account.stakerAccount.fetch(stakerWithoutAutoCompoundAccount);
    const stakerTokenAccount2Before = await getAccount(connection, stakerWithoutAutoCompoundTokenAccount);
    
    console.log("Second staker (auto-compound now enabled) staked amount before:", Number(stakerAccount2Before.stakedAmount));
    console.log("Second staker token balance before:", Number(stakerTokenAccount2Before.amount));
    
    // Claim rewards for second staker (now with auto-compound)
    console.log("Claiming rewards for second staker (now with auto-compound)...");
    await program.methods
      .claimRewards()
      .accounts({
        staker: stakerWithoutAutoCompound.publicKey,
        stakingPool,
        stakerAccount: stakerWithoutAutoCompoundAccount,
        stakerTokenAccount: stakerWithoutAutoCompoundTokenAccount,
        rewardsVaultAuthority: stakingRewardsVaultAuthority,
        stakingRewardsVault,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([stakerWithoutAutoCompound])
      .rpc();
    
    // Get balances after claiming for second staker
    const stakerAccount2After = await program.account.stakerAccount.fetch(stakerWithoutAutoCompoundAccount);
    const stakerTokenAccount2After = await getAccount(connection, stakerWithoutAutoCompoundTokenAccount);
    
    console.log("Second staker (auto-compound now enabled) staked amount after:", Number(stakerAccount2After.stakedAmount));
    console.log("Second staker token balance after:", Number(stakerTokenAccount2After.amount));
    
    // Verify rewards were auto-compounded after enabling
    assert.isTrue(
      Number(stakerAccount2After.stakedAmount) > Number(stakerAccount2Before.stakedAmount),
      "Staked amount should increase after enabling auto-compound"
    );
    assert.approximately(
      Number(stakerTokenAccount2After.amount),
      Number(stakerTokenAccount2Before.amount),
      10, // Allow small rounding differences
      "Token balance should remain unchanged after enabling auto-compound"
    );
    
    console.log("Reversed auto-compound behavior successfully verified after toggle!");
  });
});