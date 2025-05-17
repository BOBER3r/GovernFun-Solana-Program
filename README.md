# Community Token Launcher

A powerful Solana program that enables communities to launch tokens with comprehensive governance capabilities.

## 🌟 Features

- **Token Creation**: Launch your own community token with custom name and symbol
- **Governance System**: Establish a decentralized governance structure
- **Proposal Management**: Create multi-choice proposals for community decisions
- **Token-Based Voting**: Vote on proposals with tokens to determine outcomes
- **Token Economics**: Winning choices receive tokens, while losing voters get refunds
- **Secure Design**: All operations secured through program-derived accounts (PDAs)

## 🚧 Coming Soon

- **Staking Module**: Token staking capabilities currently under development
- **Gated Content**: Access control for community resources based on token holdings
- **More Governance Features**: Enhanced proposal types and execution mechanisms

## 🚀 Getting Started

### Prerequisites

- [Solana CLI Tools](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor Framework](https://www.anchor-lang.com/docs/installation)
- [Node.js](https://nodejs.org/) (v16 or later)
- [Rust](https://www.rust-lang.org/tools/install) and Cargo

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/community_token_launcher.git
cd community_token_launcher
```

2. Install dependencies:
```bash
yarn install
```

3. Build the program:
```bash
yarn build
```

### Testing

Run the test suite to verify all program functionality:
```bash
yarn test
```

### Deployment

Deploy to a Solana cluster:
```bash
yarn deploy
```

## 📚 Usage

### Creating a Community Token

```typescript
// Initialize a new token registry
const tx = await program.methods
  .initializeTokenRegistry("My Community Token", "MCT")
  .accounts({
    authority: wallet.publicKey,
    tokenMint: mintAddress,
    tokenRegistry: tokenRegistryPda,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .rpc();
```

### Setting Up Governance

```typescript
// Initialize governance for your token
const tx = await program.methods
  .initializeGovernance(
    86400, // voting period in seconds (24 hours)
    1000000000, // minimum vote threshold
    100000000, // proposal threshold
    5, // proposal threshold percentage
    "Main Governance"
  )
  .accounts({
    authority: wallet.publicKey,
    tokenMint: mintAddress,
    tokenRegistry: tokenRegistryPda,
    governance: governancePda,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .rpc();
```

### Creating and Voting on Proposals

```typescript
// Create a proposal
const tx = await program.methods
  .createMultiChoiceProposal(
    "Community Fund Allocation",
    "How should we allocate the community fund?",
    ["Project A", "Project B", "Save for later"],
    null // Use default voting period
  )
  .accounts({
    proposer: wallet.publicKey,
    governance: governancePda,
    tokenRegistry: tokenRegistryPda,
    tokenMint: mintAddress,
    proposal: proposalPda,
    systemProgram: anchor.web3.SystemProgram.programId,
  })
  .rpc();

// Vote on a proposal
const tx = await program.methods
  .lockTokensForChoice(
    new anchor.BN(1000000000), // 1 token with 9 decimals
    1 // Choice index (Project B)
  )
  .accounts({
    voter: wallet.publicKey,
    governance: governancePda,
    proposal: proposalPda,
    choiceEscrow: choiceEscrowPda,
    voterTokenAccount: voterTokenAccount,
    tokenMint: mintAddress,
    vaultAuthority: vaultAuthorityPda,
    choiceEscrowVault: choiceEscrowVaultPda,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: anchor.web3.SystemProgram.programId,
    rent: anchor.web3.SYSVAR_RENT_PUBKEY,
  })
  .rpc();
```

## 🔒 Security

- All token operations use PDAs for secure transfers
- Comprehensive account validation for all instructions
- Timing checks prevent manipulation of proposals
- Clear access control for administrative actions

## 📜 License

ISC License

---

Built with [Anchor](https://www.anchor-lang.com/) on [Solana](https://solana.com/)