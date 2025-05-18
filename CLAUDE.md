# Claude Code for Community Token Launcher


## Important Commands

- Build the program: `anchor build --no-idl`
- Create the IDL: `RUSTUP_TOOLCHAIN=nightly-2025-04-01 anchor idl build -o target/idl/community_token_launcher.json -t target/types/community_token_launcher.ts`
- Test the program: `anchor test --skip-build --skip-deploy --skip-local-validator`
- Deploy to devnet: `anchor deploy --provider.cluster devnet`
- Deploy to mainnet: `anchor deploy --provider.cluster mainnet`

## Fee Feature with Staking Rewards

The Community Token Launcher includes a 1% fee mechanism that applies to all major operations, with fees now split between the protocol wallet and staking rewards:

- 70% of collected fees go to the protocol wallet (fee collector)
- 30% of collected fees go to the staking rewards pool

### Key Fee Implementation Details

- Fees are ADDITIONAL to the user's intended amount (not deducted)
  - Example: If a user wants to stake 1000 tokens, they'll need 1010 tokens total (1000 for staking + 10 for fees)
  - Similarly, voting with 1000 tokens requires 1010 tokens total
- The full requested amount (e.g., 1000 tokens) is used for staking or voting power
- The 1% fee is calculated based on the requested amount

This fee splitting applies to all fee collection operations:
- Token Registration: 1% fee with 70/30 split
- Governance Initialization: 1% fee with 70/30 split
- Proposal Creation: 1% fee with 70/30 split
- Token Locking for Votes: 1% fee with 70/30 split
- Staking Operations: 1% fee with 70/30 split
- Winning Vote Distribution: 1% fee with 70/30 split
- Losing Vote Distribution: 1% fee with 70/30 split

Additionally, losing votes in proposals now contribute directly to the staking pool. When a proposal is executed, tokens from losing votes are automatically transferred to the staking pool rather than being returned to voters, after taking the 1% fee.

## Staking Mechanism

The Community Token Launcher now includes a staking system that enables token holders to stake their tokens and earn rewards from collected fees and gain boosted voting power:

### Key Components

- Staking Pool: Tracks total staked tokens and available rewards for each token
- Staker Account: Stores individual staker's staked amount and rewards info
- Staking Vault: Holds the staked tokens securely
- Staking Rewards Vault: Accumulates fee-based rewards (30% of all collected fees) and tokens from losing votes

### Core Staking Functions

- `initialize_staking_pool`: Sets up the staking infrastructure for a token (token creator only)
- `stake_tokens`: Allows users to stake their tokens in the pool (minimum 100 tokens required)
- `unstake_tokens`: Allows users to withdraw staked tokens (automatically claims rewards first)
- `claim_rewards`: Enables users to claim their portion of accumulated rewards
- `distribute_staking_rewards`: Manually adds rewards to the staking pool (token creator only)
- `lock_tokens_for_choice_with_staking_boost`: Vote on proposals with amplified voting power based on staking amount
- `toggle_auto_compound`: Enables or disables auto-compounding of rewards for a staker

### How Staking Works

1. **Initialization**:
   - The token creator initializes the staking pool using `initialize_staking_pool`
   - This creates the necessary vaults and tracking accounts

2. **Reward Accumulation**:
   - 30% of all fees from token operations are automatically sent to the staking rewards pool
   - Tokens from losing proposal votes are sent to the staking vault, increasing the total staked amount
   - The staking pool tracks the total reward balance available for distribution

3. **Token Staking**:
   - Users stake tokens by calling `stake_tokens`
   - A minimum of 100 tokens is required for initial staking
   - Tokens are transferred to a secure PDA vault
   - A staking account records the amount staked and stake time
   - Auto-compounding is disabled by default

4. **Reward Distribution**:
   - Rewards are proportional to the percentage of total staked tokens
   - When claiming rewards: user_reward = (staked_amount / total_staked) * reward_balance
   - There's a minimum staking period (1 day by default) to prevent gaming the system

5. **Rewards Claim and Auto-compounding**:
   - Users can claim rewards at any time with the `claim_rewards` instruction
   - With auto-compounding enabled, rewards are automatically added to the staked amount instead of being transferred to the user's wallet
   - Auto-compounding increases the user's stake (and thus future rewards) without requiring token transfers
   - Rewards are automatically processed when unstaking, respecting the auto-compound setting

6. **Logarithmic Voting Power**:
   - Users with staked tokens receive a voting power boost that scales logarithmically with their staked amount
   - The voting power multiplier is calculated using natural logarithm: `multiplier = 1.0 + ln(staked_amount)/10.0`
   - This provides diminishing returns as stake size increases, with a maximum cap of 3.0x
   - A minimum of 100 tokens must be staked to receive any boost
   - Example multipliers:
     - 100 tokens: ~1.46x multiplier
     - 500 tokens: ~1.82x multiplier
     - 1,000 tokens: ~1.99x multiplier
     - 5,000 tokens: ~2.38x multiplier
     - 10,000 tokens: ~2.53x multiplier
     - 20,000+ tokens: approaching 3.0x multiplier (the cap)
   - This logarithmic approach provides a fairer distribution of voting power and prevents whale dominance while still encouraging larger stakes

### Usage

Initialize the staking pool for a token:

```typescript
await program.methods
  .initializeStakingPool(
    distributionInterval // Time interval in seconds (e.g., 604800 for weekly)
  )
  .accounts({
    authority: provider.wallet.publicKey,
    tokenRegistry: tokenRegistryAddress,
    stakingPool: stakingPoolAddress,
    vaultAuthority: vaultAuthorityAddress,
    stakingVault: stakingVaultAddress,
    rewardsVaultAuthority: rewardsVaultAuthorityAddress,
    stakingRewardsVault: stakingRewardsVaultAddress,
    tokenMint: tokenMintAddress,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

Stake tokens:

```typescript
await program.methods
  .stakeTokens(
    new anchor.BN(amount)
  )
  .accounts({
    staker: provider.wallet.publicKey,
    stakingPool: stakingPoolAddress,
    stakerAccount: stakerAccountAddress,
    stakerTokenAccount: userTokenAccount,
    vaultAuthority: vaultAuthorityAddress,
    stakingVault: stakingVaultAddress,
    stakingRewardsVault: stakingRewardsVaultAddress,
    programConfig: programConfigAddress, // Optional, will use default if not initialized
    feeCollector: feeCollectorAddress,
    feeCollectorTokenAccount: feeCollectorTokenAccount,
    tokenMint: tokenMintAddress,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

Unstake tokens:

```typescript
await program.methods
  .unstakeTokens(
    new anchor.BN(amount)
  )
  .accounts({
    staker: provider.wallet.publicKey,
    stakingPool: stakingPoolAddress,
    stakerAccount: stakerAccountAddress,
    stakerTokenAccount: userTokenAccount,
    vaultAuthority: vaultAuthorityAddress,
    stakingVault: stakingVaultAddress,
    rewardsVaultAuthority: rewardsVaultAuthorityAddress,
    stakingRewardsVault: stakingRewardsVaultAddress,
    tokenMint: tokenMintAddress,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

Claim rewards:

```typescript
await program.methods
  .claimRewards()
  .accounts({
    staker: provider.wallet.publicKey,
    stakingPool: stakingPoolAddress,
    stakerAccount: stakerAccountAddress,
    stakerTokenAccount: userTokenAccount,
    rewardsVaultAuthority: rewardsVaultAuthorityAddress,
    stakingRewardsVault: stakingRewardsVaultAddress,
    tokenMint: tokenMintAddress,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

Toggle auto-compounding:

```typescript
await program.methods
  .toggleAutoCompound(
    true // Set to true to enable, false to disable
  )
  .accounts({
    staker: provider.wallet.publicKey,
    stakerAccount: stakerAccountAddress,
    tokenMint: tokenMintAddress,
  })
  .rpc();
```

Vote with logarithmic multiplier boost (for stakers):

```typescript
// First, derive the necessary PDAs for the vote transaction
const [proposalPda, _] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("proposal"), governancePda.toBuffer(), Buffer.from([proposalIndex])],
  program.programId
);

const [choiceEscrowPda, _] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("choice_escrow"), proposalPda.toBuffer(), Buffer.from([choiceId]), wallet.publicKey.toBuffer()],
  program.programId
);

const [vaultAuthorityPda, vaultAuthorityBump] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("vault_authority"), proposalPda.toBuffer(), Buffer.from([choiceId]), wallet.publicKey.toBuffer()],
  program.programId
);

const [choiceEscrowVaultPda, _] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("choice_escrow_vault"), proposalPda.toBuffer(), Buffer.from([choiceId]), wallet.publicKey.toBuffer()],
  program.programId
);

const [stakerAccountPda, _] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("staker"), stakingPoolPda.toBuffer(), wallet.publicKey.toBuffer()],
  program.programId
);

// Get the fee collector address (either from ProgramConfig or default)
const [programConfigPda, _] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("program_config")],
  program.programId
);

// Call the function with logarithmic voting power boost
await program.methods
  .lockTokensForChoiceWithStakingBoost(
    new anchor.BN(amount),
    choiceId
  )
  .accounts({
    voter: wallet.publicKey,
    proposal: proposalPda,
    choiceEscrow: choiceEscrowPda,
    voterTokenAccount: userTokenAccount,
    tokenMint: tokenMintAddress,
    vaultAuthority: vaultAuthorityPda,
    choiceEscrowVault: choiceEscrowVaultPda,
    programConfig: programConfigPda, // Optional, will use default if not initialized
    feeCollector: feeCollectorAddress,
    feeCollectorTokenAccount: feeCollectorTokenAccount,
    stakingPool: stakingPoolAddress,
    stakingRewardsVault: stakingRewardsVaultAddress,
    stakerAccount: stakerAccountPda,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .signers([wallet])
  .rpc();

// Note: The user will need to have amount + 1% fee tokens available
// Logarithmic voting power is automatically calculated based on staked amount:
// multiplier = 1.0 + ln(staked_amount)/10.0 (capped at 3.0x)
// Examples:
// - 100 tokens: ~1.46x multiplier
// - 500 tokens: ~1.82x multiplier
// - 1,000 tokens: ~1.99x multiplier
// - 5,000 tokens: ~2.38x multiplier
// - 10,000 tokens: ~2.53x multiplier
// - 20,000+ tokens: approaching 3.0x multiplier (the cap)
```

Example of calculating expected voting power from staked amount:

```typescript
// Helper function to estimate voting power with logarithmic boost
function calculateLogarithmicVotingPower(voteAmount, stakedAmount) {
  // Constants from program
  const MIN_STAKING_AMOUNT = 100;
  const MAX_VOTING_POWER_MULTIPLIER = 3.0;
  const LOG_FACTOR_DENOMINATOR = 10.0;
  
  // No boost if no staking or below minimum
  if (stakedAmount < MIN_STAKING_AMOUNT) {
    return voteAmount;
  }
  
  // Calculate logarithmic multiplier with cap
  const normalizedAmount = stakedAmount / MIN_STAKING_AMOUNT;
  const logFactor = Math.log(normalizedAmount) / LOG_FACTOR_DENOMINATOR;
  const multiplier = Math.min(1.0 + logFactor, MAX_VOTING_POWER_MULTIPLIER);
  
  // Return boosted vote power
  return Math.floor(voteAmount * multiplier);
}

// Example usage
const voteAmount = 1000;
const stakedAmount = 5000;
const boostedVotingPower = calculateLogarithmicVotingPower(voteAmount, stakedAmount);
console.log(`Vote amount: ${voteAmount}, Staked: ${stakedAmount}, Boosted power: ${boostedVotingPower}`);
// Output: Vote amount: 1000, Staked: 5000, Boosted power: 2381
```

## Proposal Threshold Feature

The Community Token Launcher now includes a percentage-based threshold for proposal creation:

- Token creators can set a minimum percentage of total token supply that users must hold to create proposals
- This is in addition to the existing absolute token amount threshold
- Percentage threshold is configured during governance initialization (0-100%)
- Users attempting to create proposals must meet both the absolute and percentage thresholds

### Usage

When initializing governance, specify the percentage threshold:

```typescript
await program.methods
  .initializeGovernance(
    votingPeriod,
    minVoteThreshold,
    proposalThreshold,
    proposalThresholdPercentage, // New parameter (0-100)
    governanceName,
    governanceFee
  )
  .accounts({/* ... */})
  .rpc();
```

For example, setting `proposalThresholdPercentage` to 5 means users must hold at least 5% of the total token supply to create proposals.

### Distributing Proposal Votes

After proposal execution, the token creator can distribute the tokens from the winning and losing escrows:

```typescript
// Distribute winning escrow tokens
await program.methods
  .distributeWinningEscrow()
  .accounts({
    executor: provider.wallet.publicKey, // Token creator
    proposal: proposalAddress,
    choiceEscrow: choiceEscrowAddress,
    vaultAuthority: vaultAuthorityAddress,
    escrowVault: escrowVaultAddress,
    creatorTokenAccount: creatorTokenAccount,
    tokenMint: tokenMintAddress,
    programConfig: programConfigAddress, // Optional, will use default if not initialized
    feeCollector: feeCollectorAddress,
    feeCollectorTokenAccount: feeCollectorTokenAccount,
    stakingPool: stakingPoolAddress,
    stakingRewardsVault: stakingRewardsVaultAddress,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();

// Refund losing escrow tokens to staking pool (tokens from losing votes are now added to the staking pool)
// First derive the necessary PDAs
const [proposalPda, _] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("proposal"), governancePda.toBuffer(), Buffer.from([proposalIndex])],
  program.programId
);

// Get the losing choice ID (any choice except the winning one)
const proposal = await program.account.proposal.fetch(proposalPda);
const winningChoiceId = proposal.winningChoice;
const losingChoiceId = winningChoiceId === 0 ? 1 : 0; // Simplified for example

// Derive the remaining PDAs
const [choiceEscrowPda, _] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("choice_escrow"), proposalPda.toBuffer(), Buffer.from([losingChoiceId]), voterPublicKey.toBuffer()],
  program.programId
);

const [vaultAuthorityPda, vaultAuthorityBump] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("vault_authority"), proposalPda.toBuffer(), Buffer.from([losingChoiceId]), voterPublicKey.toBuffer()],
  program.programId
);

const [escrowVaultPda, _] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("choice_escrow_vault"), proposalPda.toBuffer(), Buffer.from([losingChoiceId]), voterPublicKey.toBuffer()],
  program.programId
);

const [stakingVaultAuthorityPda, _] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("staking_vault_authority"), stakingPoolPda.toBuffer()],
  program.programId
);

const [stakingVaultPda, _] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("staking_vault"), stakingPoolPda.toBuffer()],
  program.programId
);

// Get the program config PDA
const [programConfigPda, _] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("program_config")],
  program.programId
);

// Execute refund to staking pool
await program.methods
  .refundLosingEscrow()
  .accounts({
    executor: tokenCreator.publicKey, // Token creator
    proposal: proposalPda,
    choiceEscrow: choiceEscrowPda,
    vaultAuthority: vaultAuthorityPda,
    escrowVault: escrowVaultPda,
    voterTokenAccount: voterTokenAccount, // For validation only
    tokenMint: tokenMintAddress,
    programConfig: programConfigPda, // Optional, will use default if not initialized
    feeCollector: feeCollectorAddress,
    feeCollectorTokenAccount: feeCollectorTokenAccount,
    stakingPool: stakingPoolPda,
    stakingVaultAuthority: stakingVaultAuthorityPda,
    stakingVault: stakingVaultPda,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .signers([tokenCreator])
  .rpc();

// Process:
// 1. 1% fee is taken from the losing vote tokens
// 2. 70% of that fee goes to the fee collector
// 3. The remaining tokens (99.3% of original) are transferred to the staking vault
// 4. The staking pool's total_staked_amount is increased by the transferred amount
// 5. This increases the staking pool without assigning those tokens to specific stakers
// 6. All stakers benefit proportionally through higher rewards relative to total supply
```

Note: 1% fee is collected from both winning and losing votes before distribution.

### Authorization Requirements

Several operations in the Community Token Launcher are restricted to ensure security:

1. **Token Registry Functions**
   - `register_community_token`: Anyone can register a new token
   - `update_registry`: Only the token registry authority (creator) can update
   - `add_token_metadata`: Only the token registry authority can add metadata

2. **Governance Functions**
   - `initialize_governance`: Only the token registry authority can initialize governance
   - `create_multi_choice_proposal`: Any user with enough tokens (meeting threshold requirements)
   - `execute_proposal`: Only the token registry authority or governance authority
   - `distribute_winning_escrow`: Only the token creator
   - `refund_losing_escrow`: Only the token creator

3. **Staking Functions**
   - `initialize_staking_pool`: Only the token registry authority
   - `distribute_staking_rewards`: Only the token registry authority
   - `stake_tokens`, `unstake_tokens`, `claim_rewards`: Any token holder

4. **Program Configuration**
   - `initialize_program_config`: First caller sets the program admin
   - `update_fee_collector`: Only the program admin

## Governance Settings Update via Proposal

The Community Token Launcher now supports updating governance settings through the proposal process. This allows communities to modify governance parameters through voting rather than requiring the token creator to make updates directly:

### Key Components

- `UpdateSettingsPayload`: A struct that holds the new governance settings (voting period, thresholds, etc.)
- Proposal-based updates: Changes to governance parameters occur through the normal voting process
- Security validation: Ensures only valid settings can be applied and only by authorized users
- Explicit execution type: Uses the `ProposalExecutionType::UpdateSettings` enum variant

### Core Functionality

- Creates proposals with `ProposalExecutionType::UpdateSettings` type
- Specifies new governance settings in the proposal's execution payload
- When the proposal passes and is executed, the governance settings are updated automatically
- Settings are validated before being applied to prevent invalid configurations

### How It Works

1. **Create the Proposal**:
   - Token holder creates a proposal with `ProposalExecutionType::UpdateSettings`
   - The proposal payload contains serialized `UpdateSettingsPayload` with new settings
   - The payload includes voting_period_days, min_vote_threshold, proposal_threshold, and proposal_threshold_percentage

2. **Voting Process**:
   - Community members vote on the proposal using normal voting procedures
   - If proposal reaches quorum and voting period ends, it can be executed
   - Voting is counted in the same way as any other proposal

3. **Execution & Validation**:
   - Only the token creator can execute the settings update proposal (authorization check)
   - System validates the new settings:
     - voting_period_days must be greater than 0
     - min_vote_threshold must be greater than 0
     - proposal_threshold must be greater than 0
     - proposal_threshold_percentage must be less than or equal to 100%
   - Governance account is updated with the new settings if validation passes
   - The voting_period_days is converted to seconds when stored (days * 86400)

### Usage

Create a proposal to update governance settings:

```typescript
// Create the settings payload with new values (using days for voting period)
const updateSettingsPayload = {
  voting_period_days: new anchor.BN(newVotingPeriodDays), // Number of days for voting
  min_vote_threshold: new anchor.BN(newMinVoteThreshold), // Minimum votes required for valid proposal
  proposal_threshold: new anchor.BN(newProposalThreshold), // Tokens required to create proposal
  proposal_threshold_percentage: newPercentageThreshold // Percentage of supply needed (0-100)
};

// Define the Borsh schema for serialization
const UpdateSettingsPayloadSchema = new Map([
  [
    UpdateSettingsPayload,
    {
      kind: 'struct',
      fields: [
        ['voting_period_days', 'i64'],
        ['min_vote_threshold', 'u64'],
        ['proposal_threshold', 'u64'],
        ['proposal_threshold_percentage', 'u8']
      ]
    }
  ]
]);

// Serialize the payload
const serializedPayload = borsh.serialize(
  UpdateSettingsPayloadSchema,
  updateSettingsPayload
);

// Create the proposal
await program.methods
  .createMultiChoiceProposal(
    "Update Governance Settings",
    "This proposal will update the governance settings to improve community participation",
    ["Approve", "Reject"],
    { updateSettings: {} }, // Using the UpdateSettings execution type
    serializedPayload,
    new anchor.BN(proposalFee)
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

Execute the approved proposal as the token creator:

```typescript
await program.methods
  .executeProposal()
  .accounts({
    executor: tokenCreatorWallet.publicKey, // Must be token creator
    governance: governanceAddress,
    tokenRegistry: tokenRegistryAddress,
    proposal: proposalAddress,
  })
  .signers([tokenCreatorWallet])
  .rpc();
```

This feature allows token communities to adapt their governance parameters without requiring program upgrades, making the governance system more flexible and responsive to changing community needs. The on-chain validation ensures that governance settings remain within acceptable bounds.

## Admin-Controlled Fee Collector Feature

The Community Token Launcher now includes an admin-controlled fee collector system, allowing the program administrator to update the fee destination without redeploying the program:

### Key Components

- `ProgramConfig`: A global account that stores the admin public key and fee collector address
- Default Fee Collector: Used as fallback if the ProgramConfig isn't initialized
- Admin Controls: Only the designated admin can update the fee collector address

### Core Functions

- `initialize_program_config`: Sets up the program configuration with the initial admin and fee collector address
- `update_fee_collector`: Allows the admin to change the fee collector address

### How It Works

1. **Initialization**:
   - After program deployment, the first user to call `initialize_program_config` sets the admin address and initial fee collector
   - This establishes who can control fee collection for the entire program

2. **Fee Collection Process**:
   - When any fee-collecting operation occurs, the program checks for a ProgramConfig account
   - If initialized, it uses the configured fee collector address
   - If not initialized, it falls back to the default hardcoded address

3. **Updating the Fee Collector**:
   - Only the admin (set during initialization) can call `update_fee_collector`
   - This provides a secure way to change where fees are sent without redeploying the program

### Usage

Initialize the program configuration:

```typescript
// Derive the ProgramConfig PDA address
const [programConfigPda, _] = PublicKey.findProgramAddressSync(
  [Buffer.from("program_config")],
  program.programId
);

await program.methods
  .initializeProgramConfig(
    feeCollectorAddress // The initial fee collector address
  )
  .accounts({
    admin: wallet.publicKey, // This address will be able to update the fee collector
    programConfig: programConfigPda,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

Update the fee collector (admin only):

```typescript
// Derive the ProgramConfig PDA address
const [programConfigPda, _] = PublicKey.findProgramAddressSync(
  [Buffer.from("program_config")],
  program.programId
);

await program.methods
  .updateFeeCollector(
    newFeeCollectorAddress // The new fee collector address
  )
  .accounts({
    admin: wallet.publicKey, // Must be the same as the admin set during initialization
    programConfig: programConfigPda,
  })
  .rpc();
```

Note: When calling other program functions that collect fees, you'll need to include both the `programConfig` account and the correct `feeCollector` account in your account context.

