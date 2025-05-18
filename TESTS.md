# Community Token Launcher - Test Guide

This document provides a comprehensive guide for testing the Community Token Launcher program. It outlines all key features, edge cases, and test scenarios with correct function calls to help testers create thorough tests without needing to examine the Rust code or IDL.

## Table of Contents

1. [Program Overview](#program-overview)
2. [Program Configuration Features](#program-configuration-features)
3. [Token Registry Features](#token-registry-features)
4. [Governance Features](#governance-features)
5. [Staking Features](#staking-features)
6. [Fee Collection and Distribution Features](#fee-collection-and-distribution-features)
7. [Edge Cases](#edge-cases)
8. [Test Organization Strategy](#test-organization-strategy)

## Program Overview

The Community Token Launcher is a Solana program that enables:
- Creating and managing community tokens
- Establishing governance for tokens
- Creating and voting on proposals
- Staking tokens to earn rewards
- Fee collection and distribution with configurable splits

## Program Configuration Features

### Initialize Program Config

Initializes the program configuration with an admin address and fee collector address. This should be run once after program deployment.

```typescript
await program.methods
  .initializeProgramConfig(
    feeCollectorAddress // Pubkey of the fee collector
  )
  .accounts({
    admin: adminWallet.publicKey,
    programConfig: programConfigPda,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .signers([adminWallet])
  .rpc();
```

**Test Cases:**
- Initialize program config successfully with valid inputs
- Verify only first initialization succeeds (subsequent attempts should fail)
- Verify admin can later update fee collector

### Update Fee Collector

Allows the admin to update the fee collector address.

```typescript
await program.methods
  .updateFeeCollector(
    newFeeCollectorAddress // New fee collector pubkey
  )
  .accounts({
    admin: adminWallet.publicKey,
    programConfig: programConfigPda,
  })
  .signers([adminWallet])
  .rpc();
```

**Test Cases:**
- Update fee collector successfully with admin account
- Verify non-admin accounts cannot update fee collector
- Verify fees are collected by new fee collector after update

## Token Registry Features

### Register Community Token

Registers a new community token.

```typescript
await program.methods
  .registerCommunityToken(
    "Token Name",
    "TKN",
    launchTimestamp, // unix timestamp (i64)
    "pump_fun_id_123", // unique identifier
    true, // governance enabled
    new anchor.BN(registrationFee) // e.g., 10 * 10^decimals
  )
  .accounts({
    authority: tokenCreator.publicKey,
    tokenRegistry: tokenRegistryPda,
    tokenMint: tokenMint.publicKey,
    feeCollector: feeCollectorAddress,
    authorityTokenAccount: creatorTokenAccount,
    feeCollectorTokenAccount: feeCollectorTokenAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    // Optional accounts if staking is initialized already
    stakingPool: stakingPoolPda, 
    stakingRewardsVault: stakingRewardsVaultPda,
  })
  .signers([tokenCreator])
  .rpc();
```

**Test Cases:**
- Register token with governance enabled
- Register token with governance disabled
- Verify fee collection during registration (with and without staking initialized)
- Verify can't register same token mint twice

### Add Token Metadata

Adds off-chain metadata URI to a registered token.

```typescript
await program.methods
  .addTokenMetadata(
    "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq"
  )
  .accounts({
    authority: tokenCreator.publicKey,
    tokenRegistry: tokenRegistryPda, 
    tokenMetadata: tokenMetadataPda,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .signers([tokenCreator])
  .rpc();
```

**Test Cases:**
- Add metadata successfully as the token creator
- Verify non-creator cannot add metadata
- Update metadata after it's set (if supported)

### Verify Token Ownership

Verifies if a user owns tokens of a registered community token.

```typescript
await program.methods
  .verifyTokenOwnership()
  .accounts({
    user: userWallet.publicKey,
    tokenRegistry: tokenRegistryPda,
    userTokenAccount: userTokenAccount,
  })
  .signers([userWallet])
  .rpc();
```

**Test Cases:**
- Verify user with tokens succeeds
- Verify user with zero tokens fails (expect NoTokensHeld error)

### Update Registry

Updates token registry settings (currently just governance enabled flag).

```typescript
await program.methods
  .updateRegistry(
    true // Optional: set governance_enabled
  )
  .accounts({
    authority: tokenCreator.publicKey,
    tokenRegistry: tokenRegistryPda,
  })
  .signers([tokenCreator])
  .rpc();
```

**Test Cases:**
- Enable governance on a token where it was disabled
- Disable governance on a token where it was enabled
- Verify non-creator cannot update registry

## Governance Features

### Initialize Governance

Sets up governance for a registered token.

```typescript
await program.methods
  .initializeGovernance(
    new anchor.BN(votingPeriod), // in seconds (e.g., 86400 for 1 day)
    new anchor.BN(minVoteThreshold), // minimum votes needed for valid proposal
    new anchor.BN(proposalThreshold), // tokens needed to create proposal
    proposalThresholdPercentage, // percentage of supply needed (0-100)
    "Governance Name",
    new anchor.BN(governanceFee) // fee for initializing governance
  )
  .accounts({
    authority: tokenCreator.publicKey,
    tokenRegistry: tokenRegistryPda,
    governance: governancePda,
    feeCollector: feeCollectorAddress,
    authorityTokenAccount: creatorTokenAccount,
    feeCollectorTokenAccount: feeCollectorTokenAccount,
    stakingPool: stakingPoolPda, // Optional if staking initialized
    stakingRewardsVault: stakingRewardsVaultPda, // Optional if staking initialized
    tokenMint: tokenMint.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .signers([tokenCreator])
  .rpc();
```

**Test Cases:**
- Initialize governance with valid settings
- Verify governance with invalid percentage (>100) fails
- Verify governance initialization fails if governanceEnabled=false in registry
- Verify non-creator cannot initialize governance
- Verify governance fee collection (split between protocol and staking)

### Create Multi-Choice Proposal

Creates a multi-choice proposal on a governance.

```typescript
await program.methods
  .createMultiChoiceProposal(
    "Proposal Title",
    "Detailed description of the proposal",
    ["Option A", "Option B", "Option C"], // choices (2-10 allowed)
    { updateSettings: {} }, // execution type (updateSettings, addModerator, customAction)
    Buffer.from([]), // execution payload (used for on-chain execution)
    new anchor.BN(proposalFee) // fee for creating proposal
  )
  .accounts({
    proposer: proposerWallet.publicKey,
    governance: governancePda,
    tokenRegistry: tokenRegistryPda,
    tokenMint: tokenMint.publicKey,
    proposerTokenAccount: proposerTokenAccount,
    proposal: proposalPda,
    feeCollector: feeCollectorAddress,
    feeCollectorTokenAccount: feeCollectorTokenAccount,
    stakingPool: stakingPoolPda, // Optional if staking initialized
    stakingRewardsVault: stakingRewardsVaultPda, // Optional if staking initialized
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .signers([proposerWallet])
  .rpc();
```

**Test Cases:**
- Create proposal with 2, 3, and MAX_CHOICES choices
- Verify creation fails with too few choices (0 or 1)
- Verify creation fails with too many choices (>MAX_CHOICES)
- Verify proposal creation with insufficient absolute tokens fails
- Verify proposal creation with insufficient percentage tokens fails
- Verify proposal fee collection (split between protocol and staking)
- Verify proposal creation with governance inactive fails

### Lock Tokens for Choice (Regular Voting)

Votes on a proposal by locking tokens for a specific choice.

```typescript
await program.methods
  .lockTokensForChoice(
    new anchor.BN(amount), // amount of tokens to lock
    choiceId // 0-based index of the choice
  )
  .accounts({
    voter: voterWallet.publicKey,
    proposal: proposalPda,
    choiceEscrow: choiceEscrowPda,
    voterTokenAccount: voterTokenAccount,
    tokenMint: tokenMint.publicKey,
    vaultAuthority: vaultAuthorityPda,
    choiceEscrowVault: choiceEscrowVaultPda,
    feeCollector: feeCollectorAddress,
    feeCollectorTokenAccount: feeCollectorTokenAccount,
    stakingPool: stakingPoolPda, // Optional if staking initialized
    stakingRewardsVault: stakingRewardsVaultPda, // Optional if staking initialized
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .signers([voterWallet])
  .rpc();
```

**Test Cases:**
- Vote on valid proposal with sufficient tokens
- Verify vote with zero amount fails
- Verify vote on non-active proposal fails
- Verify vote with invalid choice ID fails
- Verify fee is correctly deducted (split between protocol and staking)
- Verify vote count is correctly updated in the proposal (amount after fee)

### Lock Tokens for Choice with Staking Boost

Votes on a proposal with logarithmically boosted voting power for stakers.

```typescript
await program.methods
  .lockTokensForChoiceWithStakingBoost(
    new anchor.BN(amount), // amount of tokens to lock
    choiceId // 0-based index of the choice
  )
  .accounts({
    voter: stakerWallet.publicKey,
    proposal: proposalPda,
    choiceEscrow: choiceEscrowPda,
    voterTokenAccount: stakerTokenAccount,
    tokenMint: tokenMint.publicKey,
    vaultAuthority: vaultAuthorityPda,
    choiceEscrowVault: choiceEscrowVaultPda,
    programConfig: programConfigPda, // Optional if ProgramConfig is initialized
    feeCollector: feeCollectorAddress,
    feeCollectorTokenAccount: feeCollectorTokenAccount,
    stakingPool: stakingPoolPda,
    stakingRewardsVault: stakingRewardsVaultPda,
    stakerAccount: stakerAccountPda,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .signers([stakerWallet])
  .rpc();
```

**Test Cases:**
- Vote with staking boost and verify logarithmic multiplier is applied correctly
- Test various staking amounts to verify scaling (100, 500, 1000, 5000, 10000+ tokens)
- Verify multiplier follows formula: 1.0 + ln(staked_amount)/10.0 (capped at 3.0x)
- Verify minimum staking amount (100 tokens) is required for any boost
- Verify non-staker (or 0 staked amount) cannot use staking boost
- Verify fee is correctly deducted (split between protocol and staking)
- Compare voting power with regular voting and verify logarithmic scaling
- Test at maximum multiplier cap (3.0x) with large staking amounts

### Execute Proposal

Executes a proposal after the voting period ends.

```typescript
await program.methods
  .executeProposal()
  .accounts({
    executor: executorWallet.publicKey,
    governance: governancePda,
    tokenRegistry: tokenRegistryPda,
    proposal: proposalPda,
  })
  .signers([executorWallet])
  .rpc();
```

**Test Cases:**
- Execute proposal after voting period ends
- Verify execution before voting period ends fails
- Verify execution of non-active proposal fails (already executed)
- Verify execution with insufficient total votes fails
- Verify winning choice is correctly determined (most votes)
- Verify execution with tied votes (implementation-specific behavior)

### Distribute Winning Escrow

Distributes tokens from the winning choice to the token creator.

```typescript
await program.methods
  .distributeWinningEscrow()
  .accounts({
    executor: executorWallet.publicKey,
    proposal: proposalPda,
    choiceEscrow: winningChoiceEscrowPda,
    vaultAuthority: winningVaultAuthorityPda,
    escrowVault: winningChoiceEscrowVaultPda,
    creatorTokenAccount: creatorTokenAccount,
    tokenMint: tokenMint.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .signers([executorWallet])
  .rpc();
```

**Test Cases:**
- Distribute winning escrow successfully
- Verify distribution of non-winning escrow fails
- Verify distribution before proposal executed fails
- Verify tokens are correctly received by the token creator

### Refund Losing Escrow

Sends tokens from the losing choices to the staking pool instead of returning them to voters.

```typescript
await program.methods
  .refundLosingEscrow()
  .accounts({
    executor: executorWallet.publicKey,
    proposal: proposalPda,
    choiceEscrow: losingChoiceEscrowPda,
    vaultAuthority: losingVaultAuthorityPda,
    escrowVault: losingChoiceEscrowVaultPda,
    voterTokenAccount: voterTokenAccount, // For validation only
    tokenMint: tokenMint.publicKey,
    programConfig: programConfigPda, // Optional if ProgramConfig is initialized
    feeCollector: feeCollectorAddress,
    feeCollectorTokenAccount: feeCollectorTokenAccount,
    stakingPool: stakingPoolPda,
    stakingVaultAuthority: stakingVaultAuthorityPda,
    stakingVault: stakingVaultPda,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .signers([executorWallet])
  .rpc();
```

**Test Cases:**
- Transfer losing escrow tokens to staking pool successfully
- Verify refund of winning escrow fails
- Verify refund before proposal executed fails
- Verify tokens are correctly added to the staking pool's total_staked_amount
- Verify 1% fee is collected and split (70% to protocol, 30% added to staking total)

### Get Governance Settings

Retrieves governance settings.

```typescript
const governanceSettings = await program.methods
  .getGovernanceSettings()
  .accounts({
    authority: wallet.publicKey,
    tokenRegistry: tokenRegistryPda,
    governance: governancePda,
  })
  .signers([wallet])
  .view();
```

**Test Cases:**
- Get settings successfully as authority
- Verify returned settings match expected values
- Verify non-authority cannot get settings

## Staking Features

### Initialize Staking Pool

Initializes a staking pool for a token.

```typescript
await program.methods
  .initializeStakingPool(
    new anchor.BN(604800) // distribution interval in seconds (e.g., 604800 for weekly)
  )
  .accounts({
    authority: tokenCreator.publicKey,
    tokenRegistry: tokenRegistryPda,
    stakingPool: stakingPoolPda,
    vaultAuthority: stakingVaultAuthorityPda,
    stakingVault: stakingVaultPda,
    rewardsVaultAuthority: rewardsVaultAuthorityPda,
    stakingRewardsVault: stakingRewardsVaultPda,
    tokenMint: tokenMint.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .signers([tokenCreator])
  .rpc();
```

**Test Cases:**
- Initialize staking pool successfully
- Verify non-token creator cannot initialize staking pool
- Verify duplicate initialization fails

### Stake Tokens

Stakes tokens in the staking pool.

```typescript
await program.methods
  .stakeTokens(
    new anchor.BN(amount) // amount to stake
  )
  .accounts({
    staker: stakerWallet.publicKey,
    stakingPool: stakingPoolPda,
    stakerAccount: stakerAccountPda,
    stakerTokenAccount: stakerTokenAccount,
    vaultAuthority: stakingVaultAuthorityPda,
    stakingVault: stakingVaultPda,
    tokenMint: tokenMint.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .signers([stakerWallet])
  .rpc();
```

**Test Cases:**
- Stake valid amount of tokens
- Stake zero tokens (should fail or handle appropriately)
- Stake more tokens than in wallet (should fail)
- Stake additional tokens after initial stake

### Unstake Tokens

Unstakes tokens and returns them to the staker.

```typescript
await program.methods
  .unstakeTokens(
    new anchor.BN(amount) // amount to unstake
  )
  .accounts({
    staker: stakerWallet.publicKey,
    stakingPool: stakingPoolPda,
    stakerAccount: stakerAccountPda,
    stakerTokenAccount: stakerTokenAccount,
    vaultAuthority: stakingVaultAuthorityPda,
    stakingVault: stakingVaultPda,
    rewardsVaultAuthority: rewardsVaultAuthorityPda,
    stakingRewardsVault: stakingRewardsVaultPda,
    tokenMint: tokenMint.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .signers([stakerWallet])
  .rpc();
```

**Test Cases:**
- Unstake after minimum staking period
- Unstake before minimum staking period (should fail)
- Unstake more than staked amount (should fail)
- Unstake partial amount
- Unstake all tokens
- Verify rewards are claimed during unstaking

### Claim Rewards

Claims staking rewards without unstaking.

```typescript
await program.methods
  .claimRewards()
  .accounts({
    staker: stakerWallet.publicKey,
    stakingPool: stakingPoolPda,
    stakerAccount: stakerAccountPda,
    stakerTokenAccount: stakerTokenAccount,
    rewardsVaultAuthority: rewardsVaultAuthorityPda,
    stakingRewardsVault: stakingRewardsVaultPda,
    tokenMint: tokenMint.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .signers([stakerWallet])
  .rpc();
```

**Test Cases:**
- Claim rewards with staked tokens
- Claim with zero staked tokens (should handle appropriately)
- Claim with zero rewards (should handle appropriately)
- Verify reward calculation is correct based on stake proportion
- Multiple claims to verify reward tracking is correct

### Distribute Staking Rewards

Manually adds rewards to the staking pool (usually from governance operations or direct funding).

```typescript
await program.methods
  .distributeStakingRewards(
    new anchor.BN(amount) // amount of rewards to distribute
  )
  .accounts({
    authority: tokenCreator.publicKey,
    stakingPool: stakingPoolPda,
    authorityTokenAccount: creatorTokenAccount,
    stakingRewardsVault: stakingRewardsVaultPda,
    tokenMint: tokenMint.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .signers([tokenCreator])
  .rpc();
```

**Test Cases:**
- Distribute rewards manually
- Verify non-token creator cannot distribute (if restricted)
- Verify reward balance updates correctly in pool
- Verify rewards are available for claiming after distribution

## Fee Collection and Distribution Features

The program collects fees for various operations (1% of transaction amount) and splits them between:
- Protocol fee collector (70% of fee)
- Staking rewards (30% of fee)

**Test Cases:**
- Verify fee collection on token registration
- Verify fee collection on governance initialization
- Verify fee collection on proposal creation
- Verify fee collection on token locking for votes
- Verify correct fee splitting when staking is initialized
- Verify all fees go to protocol collector when staking is not initialized
- Verify fee collection uses new fee collector after updating program config

## Edge Cases

### Zero Amount Tests
- Register token with zero registration fee
- Create proposal with zero proposal fee
- Vote with zero tokens
- Stake zero tokens
- Unstake zero tokens
- Claim rewards with zero staked tokens

### Access Control Tests
- Non-authority attempts to register token
- Non-authority attempts to add metadata
- Non-authority attempts to initialize governance
- Non-authority attempts to initialize staking pool
- User with insufficient tokens attempts to create proposal
- User with insufficient percentage attempts to create proposal
- Non-admin attempts to update fee collector

### Timing and Status Tests
- Execute proposal before voting period ends
- Execute already executed proposal
- Unstake before minimum staking period
- Verify tokens are still locked during voting period
- Distribute winning escrow before proposal execution
- Refund losing escrow before proposal execution

### Calculation and Limit Tests
- Create proposal with minimum tokens (exactly at threshold)
- Create proposal with tokens at percentage threshold boundary
- Vote with very large token amounts (test for overflow)
- Stake very large token amounts (test for overflow)
- Create proposal with maximum number of choices
- Create proposal with empty choices array (should fail)
- Create proposal with choices exceeding maximum (should fail)

### PDA Validation Tests
- Try operations with incorrect PDA addresses
- Try operations with incorrect bumps
- Try operations with mismatched token mints across accounts

## Test Organization Strategy

Organize tests into the following categories:

1. **Setup Tests**: Environment setup, token creation, etc.
2. **Program Configuration Tests**: Admin functions, fee collector management
3. **Token Registry Tests**: Registration, metadata, ownership verification
4. **Governance Tests**: Initialization, proposal creation, voting, execution
5. **Staking Tests**: Pool initialization, staking, unstaking, rewards
6. **Fee Collection Tests**: Verification of fee collection and distribution
7. **Integration Tests**: End-to-end tests that combine multiple features
8. **Edge Case Tests**: Border cases and error conditions

Within each category, follow this pattern:
1. Happy path tests (expected successful flow)
2. Error case tests (expected failures)
3. Edge case tests (boundary conditions)