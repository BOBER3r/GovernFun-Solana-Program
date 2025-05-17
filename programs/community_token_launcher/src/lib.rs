use anchor_lang::prelude::*;
declare_id!("8MHXGF2A4np7ipWHMNe9msonHZNeKFuBvPDZdQXBnv8q");
use anchor_spl::token::{self, Mint, Token, TokenAccount};

// Constants
pub const MAX_CHOICES: usize = 10;

#[program]
pub mod community_token_launcher {
    use super::*;

    pub fn initialize_token_registry(
        ctx: Context<InitializeTokenRegistry>,
        token_name: String,
        token_symbol: String,
    ) -> Result<()> {
        let token_registry = &mut ctx.accounts.token_registry;
        
        // Initialize token registry data
        token_registry.authority = ctx.accounts.authority.key();
        token_registry.token_mint = ctx.accounts.token_mint.key();
        token_registry.token_name = token_name.clone();
        token_registry.token_symbol = token_symbol;
        token_registry.launch_timestamp = Clock::get()?.unix_timestamp;
        token_registry.governance_enabled = false;
        token_registry.is_initialized = true;
        
        msg!("Token Registry initialized for {}", token_name);
        
        Ok(())
    }

    pub fn initialize_governance(
        ctx: Context<InitializeGovernance>,
        voting_period: i64,
        min_vote_threshold: u64,
        proposal_threshold: u64,
        proposal_threshold_percentage: u8,
        name: String,
    ) -> Result<()> {
        // Initialize governance data
        let governance = &mut ctx.accounts.governance;
        governance.authority = ctx.accounts.authority.key();
        governance.token_mint = ctx.accounts.token_mint.key();
        governance.token_registry = ctx.accounts.token_registry.key();
        governance.proposal_count = 0;
        governance.voting_period = voting_period;
        governance.min_vote_threshold = min_vote_threshold;
        governance.proposal_threshold = proposal_threshold;
        governance.proposal_threshold_percentage = proposal_threshold_percentage;
        governance.name = name.clone();
        governance.is_active = true;
        governance.created_at = Clock::get()?.unix_timestamp;
        
        // Update token registry to show governance is enabled
        let token_registry = &mut ctx.accounts.token_registry;
        token_registry.governance_enabled = true;
        
        msg!("Governance initialized: {}", name);
        
        Ok(())
    }

    pub fn lock_tokens_for_choice(
        ctx: Context<LockTokensForChoice>,
        amount: u64,
        choice_id: u8,
    ) -> Result<()> {
        // SPL transfer from voter → choice escrow vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from:      ctx.accounts.voter_token_account.to_account_info(),
                    to:        ctx.accounts.choice_escrow_vault.to_account_info(),
                    authority: ctx.accounts.voter.to_account_info(),
                },
            ),
            amount,
        )?;

        let escrow = &mut ctx.accounts.choice_escrow;
        escrow.voter = ctx.accounts.voter.key();
        escrow.proposal = ctx.accounts.proposal.key();
        escrow.choice_id = choice_id;
        escrow.locked_amount = amount;

        // Update proposal vote counts for this choice
        let proposal = &mut ctx.accounts.proposal;
        proposal.update_vote_count(choice_id, amount)?;

        msg!("User voted with {} tokens", amount);

        Ok(())
    }

    pub fn create_multi_choice_proposal(
        ctx: Context<CreateMultiChoiceProposal>,
        title: String,
        description: String,
        choices: Vec<String>,
        voting_duration: Option<i64>,
    ) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let proposer = &ctx.accounts.proposer;

        // Validate choices
        require!(choices.len() > 1, ErrorCode::InvalidChoicesCount);
        require!(choices.len() <= MAX_CHOICES, ErrorCode::TooManyChoices);

        // Get proposal ID from governance
        let proposal_id = ctx.accounts.governance.proposal_count;

        // Update governance proposal count directly
        ctx.accounts.governance.proposal_count += 1;

        // Initialize the proposal
        proposal.id = proposal_id;
        proposal.governance = ctx.accounts.governance.key();
        proposal.proposer = proposer.key();
        proposal.token_creator = ctx.accounts.token_registry.authority;
        proposal.title = title.clone();
        proposal.description = description;
        let choices_len = choices.len();
        proposal.choices = choices;
        proposal.choice_vote_counts = vec![0; choices_len];
        proposal.status = ProposalStatus::Active;
        proposal.created_at = Clock::get()?.unix_timestamp;
        
        // Use custom voting duration if provided and valid, otherwise use the governance default
        let duration = match voting_duration {
            Some(duration) => {
                // Require minimum of 60 seconds (1 minute)
                require!(duration >= 60, ErrorCode::VotingDurationTooShort);
                duration
            },
            None => ctx.accounts.governance.voting_period,
        };
        
        proposal.ends_at = proposal.created_at + duration;
        proposal.winning_choice = None;

        msg!("Multi-choice proposal created: {} (ID: {})", title, proposal_id);

        Ok(())
    }

    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        let proposal = &mut ctx.accounts.proposal;
        let token_registry = &ctx.accounts.token_registry;

        // Explicitly verify that the executor is the token registry authority
        require!(
            ctx.accounts.executor.key() == token_registry.authority,
            ErrorCode::Unauthorized
        );
        
        // Comment out time check for testing
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time > proposal.ends_at, ErrorCode::VotingNotEnded);

        // Check if proposal is still active status
        require!(proposal.status == ProposalStatus::Active, ErrorCode::ProposalNotActive);

        // Find the winning choice
        let mut max_votes = 0;
        let mut winning_index = 0;

        for (i, &votes) in proposal.choice_vote_counts.iter().enumerate() {
            if votes > max_votes {
                max_votes = votes;
                winning_index = i;
            }
        }

        // Set the winning choice
        proposal.winning_choice = Some(winning_index as u8);
        proposal.status = ProposalStatus::Executed;

        msg!("Proposal executed. Winning choice: {} (index {})",
            proposal.choices[winning_index], winning_index);

        Ok(())
    }

    pub fn distribute_winning_escrow(ctx: Context<DistributeWinningEscrow>) -> Result<()> {
        let proposal = &ctx.accounts.proposal;
        let escrow = &ctx.accounts.choice_escrow;

        // Ensure proposal is executed and has a winning choice
        require!(
            proposal.status == ProposalStatus::Executed,
            ErrorCode::ProposalNotExecuted
        );

        let winning_choice = proposal.winning_choice.ok_or(ErrorCode::NoWinningChoice)?;

        // Verify this escrow is for the winning choice
        require!(
            escrow.choice_id == winning_choice,
            ErrorCode::NotWinningEscrow
        );

        // Transfer the tokens to token creator
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.escrow_vault.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[&[
                    b"vault_authority",
                    proposal.key().as_ref(),
                    &[escrow.choice_id],
                    escrow.voter.as_ref(),
                    &[ctx.bumps.vault_authority]
                ]],
            ),
            escrow.locked_amount,
        )?;

        msg!("Transferred {} tokens from winning escrow to token creator",
            escrow.locked_amount);

        Ok(())
    }

    pub fn refund_losing_escrow(ctx: Context<RefundLosingEscrow>) -> Result<()> {
        let proposal = &ctx.accounts.proposal;
        let escrow = &ctx.accounts.choice_escrow;

        // Ensure proposal is executed and has a winning choice
        require!(
            proposal.status == ProposalStatus::Executed,
            ErrorCode::ProposalNotExecuted
        );

        let winning_choice = proposal.winning_choice.ok_or(ErrorCode::NoWinningChoice)?;

        // Verify this escrow is NOT for the winning choice
        require!(
            escrow.choice_id != winning_choice,
            ErrorCode::IsWinningEscrow
        );

        // Transfer the tokens back to the voter
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.escrow_vault.to_account_info(),
                    to: ctx.accounts.voter_token_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[&[
                    b"vault_authority",
                    proposal.key().as_ref(),
                    &[escrow.choice_id],
                    escrow.voter.as_ref(),
                    &[ctx.bumps.vault_authority]
                ]],
            ),
            escrow.locked_amount,
        )?;

        msg!("Refunded {} tokens from losing escrow to voter",
            escrow.locked_amount);

        Ok(())
    }
}

// Data Structures
#[account]
pub struct ChoiceEscrow {
    pub voter: Pubkey,
    pub proposal: Pubkey,
    pub choice_id: u8,
    pub locked_amount: u64,
}

impl ChoiceEscrow {
    /// 8 bytes for the account discriminator
    /// + 32 bytes for `voter`
    /// + 32 bytes for `proposal`
    /// +  1 byte for `choice_id`
    /// +  8 bytes for `locked_amount`
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ProposalStatus {
    Active,
    Executed,
    Rejected,
}

#[account]
pub struct TokenRegistry {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub token_name: String,
    pub token_symbol: String,
    pub launch_timestamp: i64,
    pub governance_enabled: bool,
    pub is_initialized: bool,
}

impl TokenRegistry {
    pub const LEN: usize = 8    // discriminator
        + 32   // authority
        + 32   // token_mint
        + 4    // token_name length prefix
        + 32   // token_name data
        + 4    // token_symbol length prefix
        + 8    // token_symbol data
        + 8    // launch_timestamp
        + 1    // governance_enabled
        + 1;   // is_initialized
}

#[account]
pub struct Governance {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub token_registry: Pubkey,
    pub proposal_count: u64,
    pub voting_period: i64,
    pub min_vote_threshold: u64,
    pub proposal_threshold: u64,
    pub proposal_threshold_percentage: u8,
    pub name: String,
    pub is_active: bool,
    pub created_at: i64,
}

impl Governance {
    pub const LEN: usize = 8  // discriminator
        + 32  // authority
        + 32  // token_mint
        + 32  // token_registry
        + 8   // proposal_count
        + 8   // voting_period
        + 8   // min_vote_threshold
        + 8   // proposal_threshold
        + 1   // proposal_threshold_percentage
        + 4   // name: length prefix
        + 32  // name (max length)
        + 1   // is_active
        + 8;  // created_at
}

#[account]
pub struct MultiChoiceProposal {
    pub id: u64,
    pub governance: Pubkey,
    pub proposer: Pubkey,
    pub token_creator: Pubkey,
    pub title: String,
    pub description: String,
    pub choices: Vec<String>,
    pub choice_vote_counts: Vec<u64>,
    pub status: ProposalStatus,
    pub created_at: i64,
    pub ends_at: i64,
    pub winning_choice: Option<u8>,
}

impl MultiChoiceProposal {
    // Helper method to update vote count for a specific choice
    pub fn update_vote_count(&mut self, choice_id: u8, amount: u64) -> Result<()> {
        require!(
            (choice_id as usize) < self.choices.len(),
            ErrorCode::InvalidChoiceId
        );

        self.choice_vote_counts[choice_id as usize] += amount;
        Ok(())
    }

    pub const BASE_LEN: usize = 8  // discriminator
        + 8   // id
        + 32  // governance
        + 32  // proposer
        + 32  // token_creator
        + 4   // title length prefix
        + 100 // title (max length)
        + 4   // description length prefix
        + 500 // description (max length)
        // Vectors have variable size
        + 4   // choices vec length prefix
        + 4   // choice_vote_counts vec length prefix
        + 1   // status (enum)
        + 8   // created_at
        + 8   // ends_at
        + 2;  // Option<u8> for winning_choice

    // Calculate space needed for a proposal with given number of choices
    pub fn space(num_choices: usize) -> usize {
        // Base length plus space for choices
        Self::BASE_LEN
            // Each choice is a string with prefix
            + num_choices * (4 + 50)  // Assuming max 50 chars per choice
            // Each vote count is a u64
            + num_choices * 8
    }
}

// Contexts
#[derive(Accounts)]
#[instruction(amount: u64, choice_id: u8)]
pub struct LockTokensForChoice<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    #[account(
        seeds = [b"governance", token_mint.key().as_ref()],
        bump
    )]
    pub governance: Account<'info, Governance>,

    #[account(
        mut,
        constraint = proposal.governance == governance.key(),
        constraint = proposal.status == ProposalStatus::Active
    )]
    pub proposal: Account<'info, MultiChoiceProposal>,

    #[account(
        init,
        payer = voter,
        space = ChoiceEscrow::LEN,
        seeds = [
            b"choice_escrow",
            proposal.key().as_ref(),
            &[choice_id],
            voter.key().as_ref()
        ],
        bump
    )]
    pub choice_escrow: Account<'info, ChoiceEscrow>,

    #[account(
        mut,
        constraint = voter_token_account.owner == voter.key(),
        constraint = voter_token_account.mint == token_mint.key()
    )]
    pub voter_token_account: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,

    /// CHECK: This is a PDA used as token account authority
    #[account(
        seeds = [
            b"vault_authority",
            proposal.key().as_ref(),
            &[choice_id],
            voter.key().as_ref()
        ],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = voter,
        token::mint = token_mint,
        token::authority = vault_authority,
        seeds = [
            b"choice_escrow_vault",
            proposal.key().as_ref(),
            &[choice_id],
            voter.key().as_ref()
        ],
        bump
    )]
    pub choice_escrow_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(title: String, description: String, choices: Vec<String>, voting_duration: Option<i64>)]
pub struct CreateMultiChoiceProposal<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"governance", governance.token_mint.as_ref()],
        bump,
        constraint = governance.is_active
    )]
    pub governance: Account<'info, Governance>,

    #[account(
        seeds = [b"token_registry", token_registry.token_mint.as_ref()],
        bump,
        constraint = token_registry.token_mint == governance.token_mint
    )]
    pub token_registry: Account<'info, TokenRegistry>,

    #[account(
        constraint = token_mint.key() == governance.token_mint
    )]
    pub token_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = proposer,
        // Space calculation is dynamic based on number of choices
        space = 8 + MultiChoiceProposal::space(MAX_CHOICES),
        seeds = [b"proposal", governance.key().as_ref(), &governance.proposal_count.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, MultiChoiceProposal>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,

    #[account(
        seeds = [b"token_registry", token_registry.token_mint.as_ref()],
        bump,
        constraint = token_registry.token_mint == governance.token_mint
    )]
    pub token_registry: Account<'info, TokenRegistry>,

    #[account(
        seeds = [b"governance", governance.token_mint.as_ref()],
        bump
    )]
    pub governance: Account<'info, Governance>,

    #[account(
        mut,
        seeds = [b"proposal", governance.key().as_ref(), &proposal.id.to_le_bytes()],
        bump,
        constraint = proposal.governance == governance.key()
    )]
    pub proposal: Account<'info, MultiChoiceProposal>,
}

#[derive(Accounts)]
pub struct DistributeWinningEscrow<'info> {
    #[account(
        mut,
        constraint = executor.key() == proposal.token_creator @ ErrorCode::Unauthorized
    )]
    pub executor: Signer<'info>,

    #[account(
        seeds = [b"governance", token_mint.key().as_ref()],
        bump
    )]
    pub governance: Account<'info, Governance>,

    #[account(
        seeds = [b"proposal", governance.key().as_ref(), &proposal.id.to_le_bytes()],
        bump,
        constraint = proposal.governance == governance.key(),
        constraint = proposal.status == ProposalStatus::Executed
    )]
    pub proposal: Account<'info, MultiChoiceProposal>,

    #[account(
        seeds = [
            b"choice_escrow",
            proposal.key().as_ref(),
            &[choice_escrow.choice_id],
            choice_escrow.voter.as_ref()
        ],
        bump
    )]
    pub choice_escrow: Account<'info, ChoiceEscrow>,

    /// CHECK: This is a PDA used as token account authority
    #[account(
        seeds = [
            b"vault_authority",
            proposal.key().as_ref(),
            &[choice_escrow.choice_id],
            choice_escrow.voter.as_ref()
        ],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [
            b"choice_escrow_vault",
            proposal.key().as_ref(),
            &[choice_escrow.choice_id],
            choice_escrow.voter.as_ref()
        ],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = creator_token_account.owner == proposal.token_creator,
        constraint = creator_token_account.mint == token_mint.key()
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct InitializeTokenRegistry<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub token_mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = authority,
        space = TokenRegistry::LEN,
        seeds = [b"token_registry", token_mint.key().as_ref()],
        bump
    )]
    pub token_registry: Account<'info, TokenRegistry>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeGovernance<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub token_mint: Account<'info, Mint>,
    
    #[account(
        mut,
        seeds = [b"token_registry", token_mint.key().as_ref()],
        bump,
        constraint = token_registry.authority == authority.key(),
        constraint = token_registry.is_initialized
    )]
    pub token_registry: Account<'info, TokenRegistry>,
    
    #[account(
        init,
        payer = authority,
        space = Governance::LEN,
        seeds = [b"governance", token_mint.key().as_ref()],
        bump
    )]
    pub governance: Account<'info, Governance>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundLosingEscrow<'info> {
    #[account(
        mut,
        constraint = executor.key() == proposal.token_creator @ ErrorCode::Unauthorized
    )]
    pub executor: Signer<'info>,

    #[account(
        seeds = [b"governance", token_mint.key().as_ref()],
        bump
    )]
    pub governance: Account<'info, Governance>,

    #[account(
        seeds = [b"proposal", governance.key().as_ref(), &proposal.id.to_le_bytes()],
        bump,
        constraint = proposal.governance == governance.key(),
        constraint = proposal.status == ProposalStatus::Executed
    )]
    pub proposal: Account<'info, MultiChoiceProposal>,

    #[account(
        seeds = [
            b"choice_escrow",
            proposal.key().as_ref(),
            &[choice_escrow.choice_id],
            choice_escrow.voter.as_ref()
        ],
        bump
    )]
    pub choice_escrow: Account<'info, ChoiceEscrow>,

    /// CHECK: This is a PDA used as token account authority
    #[account(
        seeds = [
            b"vault_authority",
            proposal.key().as_ref(),
            &[choice_escrow.choice_id],
            choice_escrow.voter.as_ref()
        ],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [
            b"choice_escrow_vault",
            proposal.key().as_ref(),
            &[choice_escrow.choice_id],
            choice_escrow.voter.as_ref()
        ],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = voter_token_account.owner == choice_escrow.voter,
        constraint = voter_token_account.mint == token_mint.key()
    )]
    pub voter_token_account: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum ErrorCode {
    #[msg("You are not authorized to perform this action")]
    Unauthorized,
    #[msg("Governance is not active")]
    GovernanceInactive,
    #[msg("Proposal is not active")]
    ProposalNotActive,
    #[msg("Voting period has not ended yet")]
    VotingNotEnded,
    #[msg("Invalid choice ID")]
    InvalidChoiceId,
    #[msg("Invalid choices count")]
    InvalidChoicesCount,
    #[msg("Too many choices")]
    TooManyChoices,
    #[msg("Proposal not executed")]
    ProposalNotExecuted,
    #[msg("No winning choice determined")]
    NoWinningChoice,
    #[msg("Not the winning escrow")]
    NotWinningEscrow,
    #[msg("Cannot refund the winning escrow")]
    IsWinningEscrow,
    #[msg("Voting duration must be at least 60 seconds (1 minute)")]
    VotingDurationTooShort,
}
