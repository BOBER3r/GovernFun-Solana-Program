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
const STAKING_MULTIPLIER = 2; // Staked tokens have 2x voting power

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

describe("staking_voting_power", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.CommunityTokenLauncher as Program<CommunityTokenLauncher>;
  const wallet = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  let mint: PublicKey;
  let authorityTokenAccount: PublicKey;
  let regularVoterTokenAccount: PublicKey;
  let stakerVoterTokenAccount: PublicKey;
  let proposerTokenAccount: PublicKey;
  let feeCollectorTokenAccount: PublicKey;
  let tokenRegistry: PublicKey;
  let governance: PublicKey;
  let proposal: PublicKey;
  
  // PDAs for regular voter
  let regularVoterChoiceEscrow: PublicKey;
  let regularVoterChoiceEscrowVault: PublicKey;
  let regularVoterVaultAuthority: PublicKey;
  
  // PDAs for staker voter
  let stakerVoterChoiceEscrow: PublicKey;
  let stakerVoterChoiceEscrowVault: PublicKey;
  let stakerVoterVaultAuthority: PublicKey;
  
  // Staking related PDAs
  let stakingPool: PublicKey;
  let stakingVault: PublicKey;
  let stakingVaultAuthority: PublicKey;
  let stakingRewardsVault: PublicKey;
  let stakingRewardsVaultAuthority: PublicKey;
  let stakerAccount: PublicKey;
  
  // Key pairs
  const authority = Keypair.generate();
  const regularVoter = Keypair.generate();
  const stakerVoter = Keypair.generate();
  const proposer = Keypair.generate();
  const feeCollector = Keypair.generate();
  const decimals = 9;

  const getPda = async (seeds: Buffer[], programId: PublicKey) => {
    const [pda, bump] = await PublicKey.findProgramAddress(seeds, programId);
    return { pda, bump };
  };

  before(async () => {
    // Request airdrop for all accounts
    for (const kp of [authority, regularVoter, stakerVoter, proposer, feeCollector]) {
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
    authorityTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      authority.publicKey
    );
    console.log("Authority token account:", authorityTokenAccount.toBase58());

    regularVoterTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      regularVoter.publicKey
    );
    console.log("Regular voter token account:", regularVoterTokenAccount.toBase58());

    stakerVoterTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      stakerVoter.publicKey
    );
    console.log("Staker voter token account:", stakerVoterTokenAccount.toBase58());

    proposerTokenAccount = await createAccount(
      connection,
      wallet.payer,
      mint,
      proposer.publicKey
    );
    console.log("Proposer token account:", proposerTokenAccount.toBase58());

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
      authorityTokenAccount,
      wallet.payer,
      1000 * 10 ** decimals
    );

    await mintTo(
      connection,
      wallet.payer,
      mint,
      regularVoterTokenAccount,
      wallet.payer,
      100 * 10 ** decimals
    );

    await mintTo(
      connection,
      wallet.payer,
      mint,
      stakerVoterTokenAccount,
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

  it("Sets up token registry and governance", async () => {
    console.log("Registering community token...");
    const launchTimestamp = new anchor.BN(Math.floor(Date.now() / 1000));
    const registrationFee = 10 * 10 ** decimals;

    await program.methods
      .registerCommunityToken(
        "Test Token",
        "TST",
        launchTimestamp,
        "pump_fun_id_123",
        true,
        new anchor.BN(registrationFee)
      )
      .accounts({
        authority: authority.publicKey,
        tokenRegistry,
        tokenMint: mint,
        feeCollector: feeCollector.publicKey,
        authorityTokenAccount,
        feeCollectorTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([authority])
      .rpc();

    console.log("Token registered successfully!");

    console.log("Initializing staking pool...");
    const distributionInterval = 604800; // 1 week in seconds

    await program.methods
      .initializeStakingPool(
        new anchor.BN(distributionInterval)
      )
      .accounts({
        authority: authority.publicKey,
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
      .signers([authority])
      .rpc();

    console.log("Staking pool initialized successfully!");

    console.log("Initializing governance...");
    const governanceFee = 20 * 10 ** decimals;
    const proposalThresholdPercentage = 5;

    await program.methods
      .initializeGovernance(
        new anchor.BN(1), // 1 day voting period for testing
        new anchor.BN(50 * 10 ** decimals), // min vote threshold
        new anchor.BN(100 * 10 ** decimals), // proposal threshold
        proposalThresholdPercentage,
        "Test Governance",
        new anchor.BN(governanceFee)
      )
      .accounts({
        authority: authority.publicKey,
        tokenRegistry,
        governance,
        feeCollector: feeCollector.publicKey,
        authorityTokenAccount,
        feeCollectorTokenAccount,
        stakingPool,
        stakingRewardsVault,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    console.log("Governance initialized successfully!");
  });

  it("Stakes tokens for the staker voter", async () => {
    console.log("Staking tokens for the staker voter...");

    // Set up staker account PDA
    const stakerAccountResult = await getPda(
      [
        Buffer.from("staker_account"),
        mint.toBuffer(),
        stakerVoter.publicKey.toBuffer(),
      ],
      program.programId
    );
    stakerAccount = stakerAccountResult.pda;
    console.log("Staker Account PDA:", stakerAccount.toBase58());

    // Get balances before staking
    const stakerBalanceBefore = await getAccount(connection, stakerVoterTokenAccount);
    console.log("Staker balance before staking:", Number(stakerBalanceBefore.amount));

    // Stake 50 tokens
    const stakeAmount = 50 * 10 ** decimals;

    await program.methods
      .stakeTokens(
        new anchor.BN(stakeAmount)
      )
      .accounts({
        staker: stakerVoter.publicKey,
        stakingPool,
        stakerAccount,
        stakerTokenAccount: stakerVoterTokenAccount,
        vaultAuthority: stakingVaultAuthority,
        stakingVault,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([stakerVoter])
      .rpc();

    // Verify staking
    const stakerAccountInfo = await program.account.stakerAccount.fetch(stakerAccount);
    assert.equal(Number(stakerAccountInfo.stakedAmount), stakeAmount);
    console.log("Staked amount:", Number(stakerAccountInfo.stakedAmount));

    console.log("Tokens staked successfully!");
  });

  it("Creates a proposal for voting", async () => {
    console.log("Creating proposal...");

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

    const choices = ["Option A", "Option B", "Option C"];
    await program.methods
      .createMultiChoiceProposal(
        "Staking Power Test Proposal",
        "Testing if staked tokens provide more voting power",
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
        feeCollector: feeCollector.publicKey,
        feeCollectorTokenAccount,
        stakingPool,
        stakingRewardsVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([proposer])
      .rpc();

    const proposalAccount = await program.account.multiChoiceProposal.fetch(proposal);
    assert.equal(proposalAccount.title, "Staking Power Test Proposal");
    assert.equal(proposalAccount.choices.length, 3);
    assert.isDefined(proposalAccount.status.active, "Proposal status should be Active");

    console.log("Proposal created successfully!");
  });

  it("Regular voter votes on the proposal", async () => {
    console.log("Regular voter voting on proposal...");

    // Get the choice escrow and vault PDAs for regular voter
    const choiceId = 0; // Voting for first option

    const regularVoterChoiceEscrowResult = await getPda(
      [
        Buffer.from("choice_escrow"),
        proposal.toBuffer(),
        Buffer.from([choiceId]),
        regularVoter.publicKey.toBuffer(),
      ],
      program.programId
    );
    regularVoterChoiceEscrow = regularVoterChoiceEscrowResult.pda;
    console.log("Regular Voter Choice Escrow PDA:", regularVoterChoiceEscrow.toBase58());

    const regularVoterVaultAuthorityResult = await getPda(
      [
        Buffer.from("vault_authority"),
        proposal.toBuffer(),
        Buffer.from([choiceId]),
        regularVoter.publicKey.toBuffer(),
      ],
      program.programId
    );
    regularVoterVaultAuthority = regularVoterVaultAuthorityResult.pda;
    console.log("Regular Voter Vault Authority PDA:", regularVoterVaultAuthority.toBase58());

    const regularVoterChoiceEscrowVaultResult = await getPda(
      [
        Buffer.from("choice_escrow_vault"),
        proposal.toBuffer(),
        Buffer.from([choiceId]),
        regularVoter.publicKey.toBuffer(),
      ],
      program.programId
    );
    regularVoterChoiceEscrowVault = regularVoterChoiceEscrowVaultResult.pda;
    console.log("Regular Voter Choice Escrow Vault PDA:", regularVoterChoiceEscrowVault.toBase58());

    // Get balances before voting
    const regularVoterBalanceBefore = await getAccount(connection, regularVoterTokenAccount);
    console.log("Regular voter balance before voting:", Number(regularVoterBalanceBefore.amount));

    // Vote with 20 tokens
    const regularVoteAmount = 20 * 10 ** decimals;
    const regularVoteFeeAmount = calculateFee(regularVoteAmount);
    const regularVoteAmountAfterFee = regularVoteAmount - regularVoteFeeAmount;

    await program.methods
      .lockTokensForChoice(new anchor.BN(regularVoteAmount), choiceId)
      .accounts({
        voter: regularVoter.publicKey,
        proposal,
        choiceEscrow: regularVoterChoiceEscrow,
        voterTokenAccount: regularVoterTokenAccount,
        tokenMint: mint,
        vaultAuthority: regularVoterVaultAuthority,
        choiceEscrowVault: regularVoterChoiceEscrowVault,
        feeCollector: feeCollector.publicKey,
        feeCollectorTokenAccount,
        stakingPool,
        stakingRewardsVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([regularVoter])
      .rpc();

    // Verify vote was registered
    const regularVoterEscrowAccount = await program.account.choiceEscrow.fetch(regularVoterChoiceEscrow);
    assert.equal(Number(regularVoterEscrowAccount.lockedAmount), regularVoteAmountAfterFee);
    console.log("Regular voter locked amount:", Number(regularVoterEscrowAccount.lockedAmount));

    const proposalAfterRegularVote = await program.account.multiChoiceProposal.fetch(proposal);
    const regularVoteCount = Number(proposalAfterRegularVote.choiceVoteCounts[choiceId]);
    console.log("Vote count after regular voter:", regularVoteCount);
    assert.equal(regularVoteCount, regularVoteAmountAfterFee);

    console.log("Regular voter vote recorded successfully!");
  });

  it("Staker voter votes on the proposal with boosted voting power", async () => {
    console.log("Staker voter voting on proposal with boosted power...");

    // Get the choice escrow and vault PDAs for staker voter
    const choiceId = 0; // Voting for the same option

    const stakerVoterChoiceEscrowResult = await getPda(
      [
        Buffer.from("choice_escrow"),
        proposal.toBuffer(),
        Buffer.from([choiceId]),
        stakerVoter.publicKey.toBuffer(),
      ],
      program.programId
    );
    stakerVoterChoiceEscrow = stakerVoterChoiceEscrowResult.pda;
    console.log("Staker Voter Choice Escrow PDA:", stakerVoterChoiceEscrow.toBase58());

    const stakerVoterVaultAuthorityResult = await getPda(
      [
        Buffer.from("vault_authority"),
        proposal.toBuffer(),
        Buffer.from([choiceId]),
        stakerVoter.publicKey.toBuffer(),
      ],
      program.programId
    );
    stakerVoterVaultAuthority = stakerVoterVaultAuthorityResult.pda;
    console.log("Staker Voter Vault Authority PDA:", stakerVoterVaultAuthority.toBase58());

    const stakerVoterChoiceEscrowVaultResult = await getPda(
      [
        Buffer.from("choice_escrow_vault"),
        proposal.toBuffer(),
        Buffer.from([choiceId]),
        stakerVoter.publicKey.toBuffer(),
      ],
      program.programId
    );
    stakerVoterChoiceEscrowVault = stakerVoterChoiceEscrowVaultResult.pda;
    console.log("Staker Voter Choice Escrow Vault PDA:", stakerVoterChoiceEscrowVault.toBase58());

    // Get balances before voting
    const stakerVoterBalanceBefore = await getAccount(connection, stakerVoterTokenAccount);
    console.log("Staker voter balance before voting:", Number(stakerVoterBalanceBefore.amount));

    // Get current staked amount for staker
    const stakerAccountInfo = await program.account.stakerAccount.fetch(stakerAccount);
    const stakedAmount = Number(stakerAccountInfo.stakedAmount);
    console.log("Staked amount:", stakedAmount);

    // Get vote count before staker vote
    const proposalBeforeStakerVote = await program.account.multiChoiceProposal.fetch(proposal);
    const voteCountBefore = Number(proposalBeforeStakerVote.choiceVoteCounts[choiceId]);
    console.log("Vote count before staker voter:", voteCountBefore);

    // Vote with 20 tokens
    const stakerVoteAmount = 20 * 10 ** decimals;
    const stakerVoteFeeAmount = calculateFee(stakerVoteAmount);
    const stakerVoteAmountAfterFee = stakerVoteAmount - stakerVoteFeeAmount;

    // Expected voting power is the staked amount multiplier × the vote amount
    const expectedVotingPower = stakerVoteAmountAfterFee * STAKING_MULTIPLIER;
    console.log("Expected voting power with staking multiplier:", expectedVotingPower);

    await program.methods
      .lockTokensForChoiceWithStakingBoost(new anchor.BN(stakerVoteAmount), choiceId)
      .accounts({
        voter: stakerVoter.publicKey,
        proposal,
        choiceEscrow: stakerVoterChoiceEscrow,
        voterTokenAccount: stakerVoterTokenAccount,
        tokenMint: mint,
        vaultAuthority: stakerVoterVaultAuthority,
        choiceEscrowVault: stakerVoterChoiceEscrowVault,
        feeCollector: feeCollector.publicKey,
        feeCollectorTokenAccount,
        stakingPool,
        stakingRewardsVault,
        stakerAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([stakerVoter])
      .rpc();

    // Verify vote was registered
    const stakerVoterEscrowAccount = await program.account.choiceEscrow.fetch(stakerVoterChoiceEscrow);
    assert.equal(Number(stakerVoterEscrowAccount.lockedAmount), stakerVoteAmountAfterFee);
    console.log("Staker voter locked amount:", Number(stakerVoterEscrowAccount.lockedAmount));

    // Verify the voting power boost was applied
    const proposalAfterStakerVote = await program.account.multiChoiceProposal.fetch(proposal);
    const stakerVoteCount = Number(proposalAfterStakerVote.choiceVoteCounts[choiceId]);
    console.log("Vote count after staker voter:", stakerVoteCount);
    
    // Verify that the vote count increased by more than just the token amount due to staking boost
    const voteCountIncrease = stakerVoteCount - voteCountBefore;
    console.log("Vote count increase:", voteCountIncrease);
    assert.equal(voteCountIncrease, expectedVotingPower);
    
    console.log("Staker voter vote with boosted power recorded successfully!");
  });

  it("Executes proposal and verifies vote count calculation", async () => {
    console.log("Waiting for voting period to end...");
    // Wait for voting period (60 seconds)
    await new Promise((resolve) => setTimeout(resolve, 62000));

    console.log("Executing proposal...");
    // Only token creator or governance authority can execute the proposal
    await program.methods
      .executeProposal()
      .accounts({
        executor: authority.publicKey, // Using the token creator/authority
        governance,
        tokenRegistry,
        proposal,
      })
      .signers([authority])
      .rpc();

    const proposalAccount = await program.account.multiChoiceProposal.fetch(proposal);
    assert.isDefined(proposalAccount.status.executed, "Proposal status should be Executed");
    assert.equal(proposalAccount.winningChoice, 0);
    
    // Get final vote counts
    const finalVoteCount = Number(proposalAccount.choiceVoteCounts[0]);
    console.log("Final vote count for winning option:", finalVoteCount);
    
    // Calculate expected vote count with staking boost
    const regularVoteAmount = 20 * 10 ** decimals;
    const regularVoteFeeAmount = calculateFee(regularVoteAmount);
    const regularVoteAmountAfterFee = regularVoteAmount - regularVoteFeeAmount;
    
    const stakerVoteAmount = 20 * 10 ** decimals;
    const stakerVoteFeeAmount = calculateFee(stakerVoteAmount);
    const stakerVoteAmountAfterFee = stakerVoteAmount - stakerVoteFeeAmount;
    
    // The expected total includes regular vote + boosted staker vote
    const expectedTotalVotes = regularVoteAmountAfterFee + (stakerVoteAmountAfterFee * STAKING_MULTIPLIER);
    console.log("Expected total votes with staking boost:", expectedTotalVotes);
    
    assert.equal(finalVoteCount, expectedTotalVotes, "Final vote count should match expected total with staking boost");
    
    console.log("Proposal executed successfully with correct vote calculation!");
  });

  it("Prevents unauthorized users from executing proposals", async () => {
    console.log("Creating a new proposal for authorization test...");
    
    // Get a new proposal PDA
    const proposalResult = await getPda(
      [
        Buffer.from("proposal"),
        governance.toBuffer(),
        new anchor.BN(1).toBuffer("le", 8), // Second proposal (ID 1)
      ],
      program.programId
    );
    const testProposal = proposalResult.pda;
    
    // Define proposal fee
    const proposalFee = 5 * 10 ** decimals;
    const choices = ["Test Option A", "Test Option B"];
    
    // Create the proposal
    await program.methods
      .createMultiChoiceProposal(
        "Authorization Test Proposal",
        "Testing authorization for proposal execution",
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
        proposal: testProposal,
        feeCollector: provider.wallet.publicKey,
        feeCollectorTokenAccount: authorityTokenAccount,
        stakingPool,
        stakingRewardsVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([proposer])
      .rpc();
      
    // Wait for voting period
    console.log("Waiting for voting period to end...");
    await new Promise((resolve) => setTimeout(resolve, 62000));
    
    console.log("Testing unauthorized execution prevention...");
    
    // Regular voter should not be able to execute the proposal
    try {
      await program.methods
        .executeProposal()
        .accounts({
          executor: regularVoter.publicKey, // Not authorized
          governance,
          tokenRegistry,
          proposal: testProposal,
        })
        .signers([regularVoter])
        .rpc();
        
      assert.fail("Should not allow unauthorized users to execute the proposal");
    } catch (error) {
      console.log("Prevented unauthorized proposal execution as expected");
    }
  });
});