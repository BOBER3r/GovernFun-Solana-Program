# Community Token Launcher Implementation Tasks

## Overview
This document tracks the implementation progress of the Community Token Launcher Solana program.

## Tasks

### Core Functionality
- [x] Define account structures (Governance, Proposal, Escrow, Stake, Airdrop)
- [x] Implement initialize_governance function
- [x] Implement create_proposal function with threshold checking
- [x] Implement token-based voting with fees
- [x] Implement quadratic voting with fees
- [x] Implement staking functionality
- [x] Implement stake-based voting
- [x] Implement proposal finalization and token distribution
- [x] Implement direct airdrop functionality
- [x] Implement Merkle proof airdrop functionality
- [x] Implement logarithmic voting power for stakers
- [x] Implement losing votes transfer to staking pool
- [x] Implement governance settings update via proposal
- [x] Implement proposal threshold percentage validation

### New Governance Features
- [x] Implement ProposalExecutionType enum with UpdateSettings type
- [x] Implement UpdateSettingsPayload for governance settings changes
- [x] Implement settings validation in execute_proposal for governance updates
- [x] Implement logarithmic voting power boost with staking
- [x] Implement losing votes contribution to staking pool
- [x] Implement fee collection from proposal execution

### Error Handling
- [x] Define custom error types
- [x] Implement proper validation and error handling
- [x] Add validation for governance settings updates
- [x] Add authorization checks for proposal execution

### Testing
- [x] Test governance settings update via proposal
- [x] Test logarithmic staking voting power
- [x] Test losing votes staking pool contribution
- [x] Test proposal threshold percentage feature
- [ ] Ensure all tests pass

## Implementation Details

### Account Structures
- **Governance**: Stores info about the token/governance system, fees, and thresholds
  - `pump_fun_token_mint`: PublicKey of the Pump.fun token
  - `governance_token_mint`: PublicKey of the governance token
  - `website_creator`: PublicKey of the website creator
  - `token_creator`: PublicKey of the token creator
  - `platform_fee_bps`: Platform fee in basis points (fixed at 100 = 1%)
  - `creator_fee_bps`: Creator fee in basis points (configurable)
  - `proposal_threshold_bps`: Minimum percentage of tokens to create proposal
  - `proposal_count`: Number of proposals created

- **Proposal**: Tracks proposal details and vote counts
  - `governance`: Parent governance account
  - `description`: Proposal description text
  - `creator`: Creator of the proposal
  - `vote_count`: Total votes received
  - `is_finalized`: Whether proposal has been finalized
  - `index`: Numeric identifier

- **Escrow**: Holds voted tokens
  - `proposal`: Proposal being voted on
  - `voter`: Voter's public key
  - `amount`: Amount of tokens escrowed

- **Stake**: Tracks staked tokens for stake-based voting
  - `governance`: Parent governance account
  - `voter`: Staker's public key
  - `amount`: Amount of tokens staked

- **Airdrop**: Manages airdrop distributions
  - `governance`: Parent governance account
  - `merkle_root`: Optional Merkle root for validating claims
  - `amount`: Amount per claim for direct airdrops
  - `claimed`: List of addresses that have claimed

### Instructions Implemented

#### Governance
- `initialize_governance`: Creates governance system with configurable fees and thresholds

#### Proposals
- `create_proposal`: Creates a new proposal with threshold checking
- `finalize_proposal`: Finalizes voting on competing proposals and distributes tokens

#### Voting
- `vote_token_based`: Simple 1:1 voting with fees
- `vote_quadratic`: Quadratic voting (square root of tokens) with fees
- `vote_stake_based`: Voting with previously staked tokens

#### Staking
- `stake`: Stakes tokens for governance participation

#### Airdrops
- `initialize_airdrop`: Sets up direct airdrop
- `initialize_airdrop_merkle`: Sets up Merkle-based airdrop
- `claim_airdrop_direct`: Claims tokens from direct airdrop
- `claim_airdrop_merkle`: Claims tokens with Merkle proof verification

### Fee System
- Platform fee: Fixed at 1% (100 basis points)
- Creator fee: Configurable, set to 2% (200 basis points) in tests
- Fees are collected on votes and airdrops

### Voting Methods
- **Token-based**: Direct 1:1 voting power
- **Quadratic**: Square root of tokens for voting power
- **Stake-based**: Using previously staked tokens

### Helper Functions
- `keccak256`: Generates Keccak hash
- `verify_merkle_proof`: Verifies Merkle proofs for airdrop claims

### Custom Errors
- `InsufficientTokensForProposal`: User doesn't have enough tokens to create proposal
- `ProposalFinalized`: Proposal has already been finalized
- `InvalidMerkleProof`: Invalid Merkle proof provided for airdrop
- `AlreadyClaimed`: Airdrop has already been claimed by user