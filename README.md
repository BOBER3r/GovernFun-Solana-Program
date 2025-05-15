# Community Token Launcher

A Solana program for launching community tokens with governance capabilities.

## Overview

This program allows communities to:
- Create and manage token-based governance structures
- Create multi-choice proposals
- Vote on proposals with token-based voting power
- Execute winning proposals
- Distribute tokens to winners or refund tokens to losers

## Development

### Prerequisites

- Node.js and npm/yarn
- Rust and Cargo
- Solana CLI tools
- Anchor framework

### Setup

1. Install dependencies:
```bash
yarn install
```

2. Build the program:
```bash
yarn build
```

### Testing

Run the automated tests:
```bash
yarn test
```

This will execute the tests in the `tests/` directory, validating all program functionality:

- Creating multi-choice proposals
- Voting on proposals by locking tokens
- Executing proposals after voting period ends
- Distributing tokens to winners
- Refunding tokens to losers

### Deployment

Deploy to a Solana cluster:
```bash
yarn deploy
```

## Program Structure

### Main Instructions

- `create_multi_choice_proposal`: Create a new proposal with multiple choices
- `lock_tokens_for_choice`: Vote for a specific choice by locking tokens
- `execute_proposal`: Process the proposal after voting ends
- `distribute_winning_escrow`: Transfer tokens from winning choice escrows to the token creator
- `refund_losing_escrow`: Return tokens from losing choice escrows to the voters

### Key Accounts

- `TokenRegistry`: Stores token metadata and authority
- `Governance`: Controls the governance parameters
- `MultiChoiceProposal`: Contains proposal details and voting results
- `ChoiceEscrow`: Tracks token locks for specific choices

## Security Considerations

- All token transfers are secured through PDAs
- Account validation ensures proper access control
- Timestamp checks prevent early proposal execution
- Choice validation prevents invalid votes