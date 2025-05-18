import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { CommunityTokenLauncher } from "../target/types/community_token_launcher";

// Helper function to get proposal metadata
export async function getProposalMetadata(
  program: Program<CommunityTokenLauncher>,
  governancePDA: PublicKey,
  proposalId: number
): Promise<ProposalMetadata> {
  // Find the proposal PDA
  const [proposalPDA] = await PublicKey.findProgramAddress(
    [
      Buffer.from("proposal"),
      governancePDA.toBuffer(),
      new anchor.BN(proposalId).toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );

  // Call the getter function
  await program.methods
    .getProposal(proposalId)
    .accounts({
      governance: governancePDA,
      proposal: proposalPDA,
    })
    .rpc();

  // Fetch the actual data
  const proposalData = await program.account.multiChoiceProposal.fetch(
    proposalPDA
  );

  // Return formatted metadata for frontend
  return {
    id: proposalData.id.toNumber(),
    title: proposalData.title,
    description: proposalData.description,
    proposer: proposalData.proposer.toString(),
    tokenCreator: proposalData.tokenCreator.toString(),
    choices: proposalData.choices,
    choiceVoteCounts: proposalData.choiceVoteCounts.map(count => count.toString()),
    status: getStatusString(proposalData.status),
    createdAt: new Date(proposalData.createdAt * 1000).toISOString(),
    endsAt: new Date(proposalData.endsAt * 1000).toISOString(),
    winningChoice: proposalData.winningChoice !== null ? proposalData.winningChoice : null,
    // You can add more fields as needed
  };
}

// Helper function to get choice metadata
export async function getChoiceMetadata(
  program: Program<CommunityTokenLauncher>,
  governancePDA: PublicKey,
  proposalId: number,
  choiceId: number
): Promise<ChoiceMetadata> {
  // Find the proposal PDA
  const [proposalPDA] = await PublicKey.findProgramAddress(
    [
      Buffer.from("proposal"),
      governancePDA.toBuffer(),
      new anchor.BN(proposalId).toArrayLike(Buffer, "le", 8),
    ],
    program.programId
  );

  // Call the getter function
  await program.methods
    .getChoice(proposalId, choiceId)
    .accounts({
      governance: governancePDA,
      proposal: proposalPDA,
    })
    .rpc();

  // Fetch the actual data
  const proposalData = await program.account.multiChoiceProposal.fetch(
    proposalPDA
  );

  // Return formatted choice metadata
  return {
    id: choiceId,
    text: proposalData.choices[choiceId],
    voteCount: proposalData.choiceVoteCounts[choiceId].toString(),
    isWinner: proposalData.winningChoice === choiceId,
    // You can add more fields as needed
  };
}

// Helper function to get all choices for a proposal
export async function getAllChoices(
  program: Program<CommunityTokenLauncher>,
  governancePDA: PublicKey,
  proposalId: number
): Promise<ChoiceMetadata[]> {
  const proposalMetadata = await getProposalMetadata(program, governancePDA, proposalId);
  const choices: ChoiceMetadata[] = [];
  
  for (let i = 0; i < proposalMetadata.choices.length; i++) {
    const choice = await getChoiceMetadata(program, governancePDA, proposalId, i);
    choices.push(choice);
  }
  
  return choices;
}

// Helper function to convert status enum to string
function getStatusString(status: any): string {
  if (status.active !== undefined) return "Active";
  if (status.executed !== undefined) return "Executed";
  if (status.rejected !== undefined) return "Rejected";
  return "Unknown";
}

// TypeScript interfaces for frontend data
export interface ProposalMetadata {
  id: number;
  title: string;
  description: string;
  proposer: string;
  tokenCreator: string;
  choices: string[];
  choiceVoteCounts: string[];
  status: string;
  createdAt: string;
  endsAt: string;
  winningChoice: number | null;
}

export interface ChoiceMetadata {
  id: number;
  text: string;
  voteCount: string;
  isWinner: boolean;
}

// Example usage in a React component:
/*
import { useEffect, useState } from 'react';
import { getProposalMetadata, getAllChoices, ProposalMetadata, ChoiceMetadata } from './frontend-helpers';

function ProposalDisplay({ program, governancePDA, proposalId }) {
  const [proposal, setProposal] = useState<ProposalMetadata | null>(null);
  const [choices, setChoices] = useState<ChoiceMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    async function fetchData() {
      try {
        // Get proposal metadata
        const proposalData = await getProposalMetadata(program, governancePDA, proposalId);
        setProposal(proposalData);
        
        // Get all choices
        const choicesData = await getAllChoices(program, governancePDA, proposalId);
        setChoices(choicesData);
      } catch (error) {
        console.error("Error fetching proposal data:", error);
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
  }, [program, governancePDA, proposalId]);
  
  if (loading) return <div>Loading...</div>;
  if (!proposal) return <div>Proposal not found</div>;
  
  return (
    <div className="proposal-card">
      <h2>{proposal.title}</h2>
      <p className="proposal-status">Status: {proposal.status}</p>
      <p className="proposal-dates">
        Created: {new Date(proposal.createdAt).toLocaleDateString()}
        <br />
        Ends: {new Date(proposal.endsAt).toLocaleDateString()}
      </p>
      <div className="proposal-description">
        <h3>Description</h3>
        <p>{proposal.description}</p>
      </div>
      
      <div className="choices-container">
        <h3>Choices</h3>
        <ul>
          {choices.map(choice => (
            <li key={choice.id} className={choice.isWinner ? "winner" : ""}>
              <span className="choice-text">{choice.text}</span>
              <span className="vote-count">{choice.voteCount} votes</span>
              {choice.isWinner && <span className="winner-badge">Winner</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
*/