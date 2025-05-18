use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("4SUWJsjPC5o9QMz47QcSmE4EP6EYAn9xyevAAXaGAmjT");

// Default fee collector wallet address (will be replaced by ProgramConfig after initialization)
pub const DEFAULT_FEE_COLLECTOR: Pubkey = solana_program::pubkey!("Hgknisjz7kXJNNgnS5GXrZmtzhRneeAQC2nMa7naht9r");
pub const FEE_PERCENTAGE: u64 = 1; // 1% fee
pub const FEE_BASIS_POINTS: u64 = 100; // Denominator for fee calculation (1% = 1/100)
pub const PROTOCOL_FEE_PERCENTAGE: u64 = 70; // 70% of collected fees go to protocol/creator
pub const STAKING_REWARDS_PERCENTAGE: u64 = 30; // 30% of collected fees go to staking rewards
pub const MIN_STAKING_PERIOD: i64 = 86400; // 1 day in seconds
pub const SECONDS_PER_DAY: i64 = 86400; // 24 hours * 60 minutes * 60 seconds
pub const MIN_STAKING_AMOUNT: u64 = 100; // Minimum amount of tokens that can be staked
pub const MAX_VOTING_POWER_MULTIPLIER: f64 = 3.0; // Maximum multiplier cap for logarithmic voting power (3.0x)
pub const LOG_FACTOR_DENOMINATOR: f64 = 10.0; // Denominator for the logarithmic factor calculation

// Helper function to calculate fee amount
pub fn calculate_fee(amount: u64) -> u64 {
    amount * FEE_PERCENTAGE / FEE_BASIS_POINTS
}

// Helper function to calculate protocol fee amount (70% of fee)
pub fn calculate_protocol_fee(fee_amount: u64) -> u64 {
    fee_amount * PROTOCOL_FEE_PERCENTAGE / 100
}

// Helper function to calculate staking reward amount (30% of fee)
pub fn calculate_staking_reward(fee_amount: u64) -> u64 {
    fee_amount * STAKING_REWARDS_PERCENTAGE / 100
}

// Helper function to calculate logarithmic voting power with cap
pub fn calculate_logarithmic_voting_power(vote_amount: u64, staked_amount: u64) -> u64 {
    let base_power = vote_amount;
    
    // No staking = no boost
    if staked_amount == 0 {
        return base_power;
    }
    
    // Ensure minimum staking amount is met
    if staked_amount < MIN_STAKING_AMOUNT {
        return base_power;
    }
    
    // Calculate logarithmic multiplier (capped at MAX_VOTING_POWER_MULTIPLIER)
    // Use a more sensitive formula to differentiate small increments
    let staked_amount_f64 = staked_amount as f64;
    
    // Formula: 1.0 + ln(staked_amount / MIN_STAKING_AMOUNT) / LOG_FACTOR_DENOMINATOR
    // This ensures that at MIN_STAKING_AMOUNT, the multiplier starts above 1.0
    // and increases logarithmically for any amount above the minimum
    let normalized_amount = staked_amount_f64 / (MIN_STAKING_AMOUNT as f64);
    let log_factor = normalized_amount.ln() / LOG_FACTOR_DENOMINATOR;
    
    // Even at the minimum staking amount (100), we get a small boost
    // For 100 tokens: 1.0 + ln(1.0)/10.0 = 1.0 (because ln(1.0) = 0)
    // For 101 tokens: 1.0 + ln(1.01)/10.0 ≈ 1.001
    // For 150 tokens: 1.0 + ln(1.5)/10.0 ≈ 1.04
    let multiplier = (1.0 + log_factor).min(MAX_VOTING_POWER_MULTIPLIER);
    
    // Apply multiplier and convert back to u64
    ((base_power as f64) * multiplier) as u64
}

#[program]
pub mod community_token_launcher {
    use super::*;

    // Program Configuration Functions
    pub fn initialize_program_config(
        ctx: Context<InitializeProgramConfig>,
        fee_collector: Pubkey,
    ) -> Result<()> {
        let program_config = &mut ctx.accounts.program_config;
        
        // Check if the program config is already initialized
        require!(
            !program_config.is_initialized,
            ErrorCode::ConfigAlreadyInitialized
        );
        
        // Set the admin and fee collector
        program_config.admin = ctx.accounts.admin.key();
        program_config.fee_collector = fee_collector;
        program_config.is_initialized = true;
        
        msg!("Program config initialized with admin: {}", program_config.admin);
        msg!("Fee collector set to: {}", program_config.fee_collector);
        
        Ok(())
    }
    
    pub fn update_fee_collector(
        ctx: Context<UpdateFeeCollector>,
        new_fee_collector: Pubkey,
    ) -> Result<()> {
        let program_config = &mut ctx.accounts.program_config;
        
        // Only the program admin can update the fee collector
        require!(
            program_config.admin == ctx.accounts.admin.key(),
            ErrorCode::Unauthorized
        );
        
        // Update the fee collector
        program_config.fee_collector = new_fee_collector;
        
        msg!("Fee collector updated to: {}", new_fee_collector);
        
        Ok(())
    }

    // Token Registry Functions
    pub fn register_community_token(
        ctx: Context<RegisterCommunityToken>,
        token_name: String,
        token_symbol: String,
        launch_timestamp: i64,
        pump_fun_id: String,
        governance_enabled: bool,
        registration_fee: u64,
    ) -> Result<()> {
        let token_registry = &mut ctx.accounts.token_registry;

        // Store the token information
        token_registry.authority = ctx.accounts.authority.key();
        token_registry.token_mint = ctx.accounts.token_mint.key();
        token_registry.token_name = token_name;
        token_registry.token_symbol = token_symbol;
        token_registry.launch_timestamp = launch_timestamp;
        token_registry.pump_fun_id = pump_fun_id;
        token_registry.governance_enabled = governance_enabled;
        token_registry.is_initialized = true;

        // Get the fee collector from ProgramConfig or use default
        let fee_collector = get_fee_collector(ctx.accounts.program_config.as_ref());
        
        // Verify that the provided fee_collector account matches the expected address
        require!(
            ctx.accounts.fee_collector.key() == fee_collector,
            ErrorCode::InvalidFeeCollector
        );

        // Calculate the fee amount (1% of the registration fee)
        let fee_amount = calculate_fee(registration_fee);

        if fee_amount > 0 {
            // Calculate protocol fee (70% of fee) and staking reward (30% of fee)
            let protocol_fee = calculate_protocol_fee(fee_amount);
            let staking_reward = calculate_staking_reward(fee_amount);

            // Transfer the protocol fee to the fee collector
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.authority_token_account.to_account_info(),
                        to: ctx.accounts.fee_collector_token_account.to_account_info(),
                        authority: ctx.accounts.authority.to_account_info(),
                    },
                ),
                protocol_fee,
            )?;

            msg!("Transferred {} tokens as protocol fee to collector", protocol_fee);

            // Check if staking pool exists, if so transfer rewards
            if ctx.accounts.staking_pool.is_some() && ctx.accounts.staking_rewards_vault.is_some() {
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        token::Transfer {
                            from: ctx.accounts.authority_token_account.to_account_info(),
                            to: ctx.accounts.staking_rewards_vault.as_ref().unwrap().to_account_info(),
                            authority: ctx.accounts.authority.to_account_info(),
                        },
                    ),
                    staking_reward,
                )?;

                // Update staking pool reward balance
                ctx.accounts.staking_pool.as_mut().unwrap().reward_balance += staking_reward;

                msg!("Transferred {} tokens to staking rewards", staking_reward);
            } else {
                // If staking pool doesn't exist yet, send all to fee collector
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        token::Transfer {
                            from: ctx.accounts.authority_token_account.to_account_info(),
                            to: ctx.accounts.fee_collector_token_account.to_account_info(),
                            authority: ctx.accounts.authority.to_account_info(),
                        },
                    ),
                    staking_reward,
                )?;

                msg!("Staking pool not initialized, transferred remaining {} tokens to collector", staking_reward);
            }
        }

        // Optional: Initialize token governance if enabled
        if governance_enabled {
            msg!("Governance is enabled - you should initialize the governance contract");
        }

        Ok(())
    }

    pub fn lock_tokens_for_choice(
        ctx: Context<LockTokensForChoice>,
        amount: u64,
        choice_id: u8,
    ) -> Result<()> {
        // Get the fee collector from ProgramConfig or use default
        let fee_collector = get_fee_collector(ctx.accounts.program_config.as_ref());
        
        // Verify that the provided fee_collector account matches the expected address
        require!(
            ctx.accounts.fee_collector.key() == fee_collector,
            ErrorCode::InvalidFeeCollector
        );
        
        // Calculate fee (1% of the locked amount) - fee is ADDITIONAL, not deducted
        let fee_amount = calculate_fee(amount);

        if fee_amount > 0 {
            // Calculate protocol fee (70% of fee) and staking reward (30% of fee)
            let protocol_fee = calculate_protocol_fee(fee_amount);
            let staking_reward = calculate_staking_reward(fee_amount);

            // Transfer the protocol fee to the fee collector
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.voter_token_account.to_account_info(),
                        to: ctx.accounts.fee_collector_token_account.to_account_info(),
                        authority: ctx.accounts.voter.to_account_info(),
                    },
                ),
                protocol_fee,
            )?;

            msg!("Transferred {} tokens as protocol fee to collector", protocol_fee);

            // Check if staking pool exists, if so transfer rewards
            if ctx.accounts.staking_pool.is_some() && ctx.accounts.staking_rewards_vault.is_some() {
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        token::Transfer {
                            from: ctx.accounts.voter_token_account.to_account_info(),
                            to: ctx.accounts.staking_rewards_vault.as_ref().unwrap().to_account_info(),
                            authority: ctx.accounts.voter.to_account_info(),
                        },
                    ),
                    staking_reward,
                )?;

                // Update staking pool reward balance
                ctx.accounts.staking_pool.as_mut().unwrap().reward_balance += staking_reward;

                msg!("Transferred {} tokens to staking rewards", staking_reward);
            } else {
                // If staking pool doesn't exist yet, send all to fee collector
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        token::Transfer {
                            from: ctx.accounts.voter_token_account.to_account_info(),
                            to: ctx.accounts.fee_collector_token_account.to_account_info(),
                            authority: ctx.accounts.voter.to_account_info(),
                        },
                    ),
                    staking_reward,
                )?;

                msg!("Staking pool not initialized, transferred remaining {} tokens to collector", staking_reward);
            }
        }

        // SPL transfer from voter → choice escrow vault (full amount, fee is additional)
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
        escrow.locked_amount = amount; // Store the full amount

        // Update proposal vote counts for this choice
        let proposal = &mut ctx.accounts.proposal;
        proposal.update_vote_count(choice_id, amount)?;

        msg!("User voted with {} tokens plus {} fee ({}% of the amount)", 
             amount, fee_amount, FEE_PERCENTAGE);

        Ok(())
    }

    pub fn lock_tokens_for_choice_with_staking_boost(
        ctx: Context<LockTokensForChoiceWithStakingBoost>,
        amount: u64,
        choice_id: u8,
    ) -> Result<()> {
        // Get the fee collector from ProgramConfig or use default
        let fee_collector = get_fee_collector(ctx.accounts.program_config.as_ref());
        
        // Verify that the provided fee_collector account matches the expected address
        require!(
            ctx.accounts.fee_collector.key() == fee_collector,
            ErrorCode::InvalidFeeCollector
        );
        
        // Calculate fee (1% of the locked amount) - fee is ADDITIONAL, not deducted
        let fee_amount = calculate_fee(amount);

        if fee_amount > 0 {
            // Calculate protocol fee (70% of fee) and staking reward (30% of fee)
            let protocol_fee = calculate_protocol_fee(fee_amount);
            let staking_reward = calculate_staking_reward(fee_amount);

            // Transfer the protocol fee to the fee collector
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.voter_token_account.to_account_info(),
                        to: ctx.accounts.fee_collector_token_account.to_account_info(),
                        authority: ctx.accounts.voter.to_account_info(),
                    },
                ),
                protocol_fee,
            )?;

            msg!("Transferred {} tokens as protocol fee to collector", protocol_fee);

            // Transfer staking rewards
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.voter_token_account.to_account_info(),
                        to: ctx.accounts.staking_rewards_vault.to_account_info(),
                        authority: ctx.accounts.voter.to_account_info(),
                    },
                ),
                staking_reward,
            )?;

            // Update staking pool reward balance
            ctx.accounts.staking_pool.reward_balance += staking_reward;
            msg!("Transferred {} tokens to staking rewards", staking_reward);
        }

        // SPL transfer from voter → choice escrow vault (full amount, fee is additional)
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
        escrow.locked_amount = amount; // Store the full amount

        // Calculate vote boost based on staked tokens
        let staker_account = &ctx.accounts.staker_account;

        // Verify the staker account belongs to the voter
        require!(
            staker_account.staker == ctx.accounts.voter.key(),
            ErrorCode::Unauthorized
        );

        // Verify the user has staked tokens
        require!(
            staker_account.staked_amount > 0,
            ErrorCode::NoStakedTokens
        );

        // Calculate the voting power using logarithmic scaling
        let boosted_vote_power = calculate_logarithmic_voting_power(amount, staker_account.staked_amount);

        // Calculate the effective multiplier for logging purposes
        let effective_multiplier = if amount > 0 {
            (boosted_vote_power as f64) / (amount as f64)
        } else {
            1.0
        };

        msg!("Regular vote power: {}, Staked amount: {}, Effective multiplier: {:.2}x, Boosted vote power: {}", 
             amount, 
             staker_account.staked_amount, 
             effective_multiplier,
             boosted_vote_power);

        // Update proposal vote counts for this choice with the boosted power
        let proposal = &mut ctx.accounts.proposal;
        proposal.update_vote_count(choice_id, boosted_vote_power)?;

        msg!("User voted with {} tokens plus {} fee ({}% of the amount)", 
             amount, fee_amount, FEE_PERCENTAGE);

        Ok(())
    }

    pub fn update_registry(
        ctx: Context<UpdateRegistry>,
        governance_enabled: Option<bool>,
    ) -> Result<()> {
        let token_registry = &mut ctx.accounts.token_registry;
        require!(
            token_registry.authority == ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );
        if let Some(gov_enabled) = governance_enabled {
            msg!("Updating governance_enabled to {}", gov_enabled);
            token_registry.governance_enabled = gov_enabled;
        }
        Ok(())
    }

    pub fn add_token_metadata(
        ctx: Context<AddTokenMetadata>,
             metadata_uri: String,
         ) -> Result<()> {
             let _token_registry = &ctx.accounts.token_registry;
             let token_metadata = &mut ctx.accounts.token_metadata;

             // only authority can set the URI
            require!(
                 _token_registry.authority == ctx.accounts.authority.key(),
                 ErrorCode::Unauthorized
             );

             token_metadata.token_mint   = _token_registry.token_mint;
             token_metadata.metadata_uri = metadata_uri;
        Ok(())
    }

    pub fn verify_token_ownership(ctx: Context<VerifyTokenOwnership>) -> Result<()> {
        let _token_registry = &ctx.accounts.token_registry;
        let token_account = &ctx.accounts.user_token_account;

        // Check if the user holds any tokens
        require!(
            token_account.amount > 0,
            ErrorCode::NoTokensHeld
        );

        // Verified - emit event or update state as needed
        msg!("User {} verified as token holder", ctx.accounts.user.key());

        Ok(())
    }

    // Governance Functions
    pub fn initialize_governance(
        ctx: Context<InitializeGovernance>,
        voting_period_days: i64,
        min_vote_threshold: u64,
        proposal_threshold: u64,
        proposal_threshold_percentage: u8, // New parameter for percentage-based threshold
        governance_name: String,
        governance_fee: u64,
    ) -> Result<()> {
        let governance = &mut ctx.accounts.governance;
        let token_registry = &ctx.accounts.token_registry;

        // Verify authority from token registry
        require!(
            token_registry.authority == ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );

        // Verify governance is enabled in registry
        require!(
            token_registry.governance_enabled,
            ErrorCode::GovernanceDisabled
        );

        // Validate percentage is within valid range (0-100)
        require!(
            proposal_threshold_percentage <= 100,
            ErrorCode::InvalidThresholdPercentage
        );

        // Get the fee collector from ProgramConfig or use default
        let fee_collector = get_fee_collector(ctx.accounts.program_config.as_ref());
        
        // Verify that the provided fee_collector account matches the expected address
        require!(
            ctx.accounts.fee_collector.key() == fee_collector,
            ErrorCode::InvalidFeeCollector
        );

        // Calculate fee (1% of governance fee)
        let fee_amount = calculate_fee(governance_fee);

        if fee_amount > 0 {
            // Calculate protocol fee (70% of fee) and staking reward (30% of fee)
            let protocol_fee = calculate_protocol_fee(fee_amount);
            let staking_reward = calculate_staking_reward(fee_amount);

            // Transfer the protocol fee to the fee collector
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.authority_token_account.to_account_info(),
                        to: ctx.accounts.fee_collector_token_account.to_account_info(),
                        authority: ctx.accounts.authority.to_account_info(),
                    },
                ),
                protocol_fee,
            )?;

            msg!("Transferred {} tokens as protocol fee to collector", protocol_fee);

            // Check if staking pool exists, if so transfer rewards
            if ctx.accounts.staking_pool.is_some() && ctx.accounts.staking_rewards_vault.is_some() {
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        token::Transfer {
                            from: ctx.accounts.authority_token_account.to_account_info(),
                            to: ctx.accounts.staking_rewards_vault.as_ref().unwrap().to_account_info(),
                            authority: ctx.accounts.authority.to_account_info(),
                        },
                    ),
                    staking_reward,
                )?;

                // Update staking pool reward balance
                ctx.accounts.staking_pool.as_mut().unwrap().reward_balance += staking_reward;

                msg!("Transferred {} tokens to staking rewards", staking_reward);
            } else {
                // If staking pool doesn't exist yet, send all to fee collector
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        token::Transfer {
                            from: ctx.accounts.authority_token_account.to_account_info(),
                            to: ctx.accounts.fee_collector_token_account.to_account_info(),
                            authority: ctx.accounts.authority.to_account_info(),
                        },
                    ),
                    staking_reward,
                )?;

                msg!("Staking pool not initialized, transferred remaining {} tokens to collector", staking_reward);
            }
        }

        // Validate voting period days is reasonable
        require!(
            voting_period_days > 0,
            ErrorCode::InvalidGovernanceSettings
        );

        // Convert voting period from days to seconds
        let voting_period_seconds = voting_period_days * SECONDS_PER_DAY;

        // Initialize governance
        governance.authority = ctx.accounts.authority.key();
        governance.token_mint = token_registry.token_mint;
        governance.token_registry = token_registry.key();
        governance.voting_period = voting_period_seconds;  // Store the converted value in seconds
        governance.min_vote_threshold = min_vote_threshold;
        governance.proposal_threshold = proposal_threshold;
        governance.proposal_threshold_percentage = proposal_threshold_percentage;
        governance.name = governance_name;
        governance.proposal_count = 0;
        governance.is_active = true;
        governance.created_at = Clock::get()?.unix_timestamp;

        msg!("Governance initialized for token: {}", token_registry.token_name);

        Ok(())
    }

    pub fn create_multi_choice_proposal(
        ctx: Context<CreateMultiChoiceProposal>,
        title: String,
        description: String,
        choices: Vec<String>,
        execution_type: ProposalExecutionType,
        execution_payload: Vec<u8>,
        proposal_fee: u64,
    ) -> Result<()> {
        let governance = &mut ctx.accounts.governance;
        let proposal = &mut ctx.accounts.proposal;
        let proposer = &ctx.accounts.proposer;

        // Check if governance is active
        require!(governance.is_active, ErrorCode::GovernanceInactive);

        // Check if proposer has enough tokens to create a proposal (absolute threshold)
        let token_account = &ctx.accounts.proposer_token_account;
        require!(
            token_account.amount >= governance.proposal_threshold,
            ErrorCode::ProposalThresholdNotMet
        );
        require!(token_account.amount > 0, ErrorCode::InsufficientTokens);

        // Check percentage threshold if it's set
        if governance.proposal_threshold_percentage > 0 {
            // Get the total supply of the token
            let mint_info = &ctx.accounts.token_mint;
            let total_supply = mint_info.supply;

            // Calculate required amount based on percentage
            let required_percentage_amount = (total_supply * governance.proposal_threshold_percentage as u64) / 100;

            // Check if proposer meets the percentage threshold
            require!(
                token_account.amount >= required_percentage_amount,
                ErrorCode::PercentageThresholdNotMet
            );

            msg!("Proposer has {}% of total supply, needed {}%",
                (token_account.amount * 100) / total_supply,
                governance.proposal_threshold_percentage);
        }

        // Validate choices
        require!(choices.len() > 1, ErrorCode::InvalidChoicesCount);
        require!(choices.len() <= MAX_CHOICES, ErrorCode::TooManyChoices);

        // Get the fee collector from ProgramConfig or use default
        let fee_collector = get_fee_collector(ctx.accounts.program_config.as_ref());
        
        // Verify that the provided fee_collector account matches the expected address
        require!(
            ctx.accounts.fee_collector.key() == fee_collector,
            ErrorCode::InvalidFeeCollector
        );

        // Calculate the fee (1% of proposal fee)
        let fee_amount = calculate_fee(proposal_fee);

        if fee_amount > 0 {
            // Calculate protocol fee (70% of fee) and staking reward (30% of fee)
            let protocol_fee = calculate_protocol_fee(fee_amount);
            let staking_reward = calculate_staking_reward(fee_amount);

            // Transfer the protocol fee to the fee collector
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.proposer_token_account.to_account_info(),
                        to: ctx.accounts.fee_collector_token_account.to_account_info(),
                        authority: ctx.accounts.proposer.to_account_info(),
                    },
                ),
                protocol_fee,
            )?;

            msg!("Transferred {} tokens as protocol fee to collector", protocol_fee);

            // Check if staking pool exists, if so transfer rewards
            if ctx.accounts.staking_pool.is_some() && ctx.accounts.staking_rewards_vault.is_some() {
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        token::Transfer {
                            from: ctx.accounts.proposer_token_account.to_account_info(),
                            to: ctx.accounts.staking_rewards_vault.as_ref().unwrap().to_account_info(),
                            authority: ctx.accounts.proposer.to_account_info(),
                        },
                    ),
                    staking_reward,
                )?;

                // Update staking pool reward balance
                ctx.accounts.staking_pool.as_mut().unwrap().reward_balance += staking_reward;

                msg!("Transferred {} tokens to staking rewards", staking_reward);
            } else {
                // If staking pool doesn't exist yet, send all to fee collector
                token::transfer(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        token::Transfer {
                            from: ctx.accounts.proposer_token_account.to_account_info(),
                            to: ctx.accounts.fee_collector_token_account.to_account_info(),
                            authority: ctx.accounts.proposer.to_account_info(),
                        },
                    ),
                    staking_reward,
                )?;

                msg!("Staking pool not initialized, transferred remaining {} tokens to collector", staking_reward);
            }
        }

        // Generate proposal ID
        let proposal_id = governance.proposal_count;
        governance.proposal_count += 1;

        // Initialize the proposal
        proposal.id = proposal_id;
        proposal.governance = governance.key();
        proposal.proposer = proposer.key();
        proposal.token_creator = ctx.accounts.token_registry.authority;
        proposal.title = title.clone();
        proposal.description = description;
        let choices_len = choices.len();
        proposal.choices = choices;
        proposal.choice_vote_counts = vec![0; choices_len];
        proposal.execution_type = execution_type;
        proposal.execution_payload = execution_payload;
        proposal.status = ProposalStatus::Active;
        proposal.created_at = Clock::get()?.unix_timestamp;
        proposal.ends_at = proposal.created_at + governance.voting_period;
        proposal.winning_choice = None;

        msg!("Multi-choice proposal created: {} (ID: {})", title, proposal_id);

        Ok(())
    }

    pub fn execute_proposal(ctx: Context<ExecuteProposal>) -> Result<()> {
        let governance = &mut ctx.accounts.governance;
        let proposal = &mut ctx.accounts.proposal;
        let token_registry = &ctx.accounts.token_registry;

        // Explicitly verify that the executor is either the token registry authority or governance authority
        require!(
            ctx.accounts.executor.key() == token_registry.authority || 
            ctx.accounts.executor.key() == governance.authority,
            ErrorCode::Unauthorized
        );

        // Check if proposal has ended
        let current_time = Clock::get()?.unix_timestamp;
        require!(current_time > proposal.ends_at, ErrorCode::VotingNotEnded);

        // Check if proposal is still active status
        require!(proposal.status == ProposalStatus::Active, ErrorCode::ProposalNotActive);

        // Calculate the total votes
        let total_votes: u64 = proposal.choice_vote_counts.iter().sum();

        // Check if proposal meets minimum threshold
        require!(
            total_votes >= governance.min_vote_threshold,
            ErrorCode::VoteThresholdNotMet
        );

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

        msg!("Tokens from winning escrow will be transferred to token creator");

        // Execute proposal based on execution type
        match proposal.execution_type {
            ProposalExecutionType::UpdateSettings => {
                msg!("Executing proposal to update settings");
                
                // For UpdateSettings proposals, verify executor is token creator
                require!(
                    ctx.accounts.executor.key() == token_registry.authority,
                    ErrorCode::Unauthorized
                );
                
                // Deserialize the execution payload into UpdateSettingsPayload
                let settings_payload = match UpdateSettingsPayload::try_from_slice(&proposal.execution_payload) {
                    Ok(payload) => payload,
                    Err(_) => {
                        msg!("Failed to deserialize UpdateSettingsPayload");
                        return Err(ErrorCode::InvalidPayload.into());
                    }
                };
                
                // Validate new settings
                require!(settings_payload.voting_period_days > 0, ErrorCode::InvalidGovernanceSettings);
                require!(settings_payload.min_vote_threshold > 0, ErrorCode::InvalidGovernanceSettings);
                require!(settings_payload.proposal_threshold > 0, ErrorCode::InvalidGovernanceSettings);
                require!(settings_payload.proposal_threshold_percentage <= 100, ErrorCode::InvalidThresholdPercentage);
                
                // Convert voting period from days to seconds
                let voting_period_seconds = settings_payload.voting_period_days * SECONDS_PER_DAY;
                
                // Update governance settings
                governance.voting_period = voting_period_seconds;
                governance.min_vote_threshold = settings_payload.min_vote_threshold;
                governance.proposal_threshold = settings_payload.proposal_threshold;
                governance.proposal_threshold_percentage = settings_payload.proposal_threshold_percentage;
                
                msg!("Governance settings updated successfully");
                msg!("New voting period: {} days ({} seconds)", settings_payload.voting_period_days, voting_period_seconds);
                msg!("New min vote threshold: {}", governance.min_vote_threshold);
                msg!("New proposal threshold: {}", governance.proposal_threshold);
                msg!("New proposal threshold percentage: {}%", governance.proposal_threshold_percentage);
            },
            ProposalExecutionType::AddModerator => {
                msg!("Executing proposal to add moderator");
            },
            ProposalExecutionType::CustomAction => {
                msg!("Executing custom proposal action");
            },
        }

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

        // Get the fee collector from ProgramConfig or use default
        let fee_collector = get_fee_collector(ctx.accounts.program_config.as_ref());
        
        // Verify that the provided fee_collector account matches the expected address
        require!(
            ctx.accounts.fee_collector.key() == fee_collector,
            ErrorCode::InvalidFeeCollector
        );

        // Calculate fee (1% of the winning amount)
        let fee_amount = calculate_fee(escrow.locked_amount);
        let amount_after_fee = escrow.locked_amount - fee_amount;

        if fee_amount > 0 {
            // Calculate protocol fee (70% of fee) and staking reward (30% of fee)
            let protocol_fee = calculate_protocol_fee(fee_amount);
            let staking_reward = calculate_staking_reward(fee_amount);

            // Transfer the protocol fee to the fee collector
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.escrow_vault.to_account_info(),
                        to: ctx.accounts.fee_collector_token_account.to_account_info(),
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
                protocol_fee,
            )?;

            msg!("Transferred {} tokens as protocol fee to collector", protocol_fee);

            // Transfer staking rewards
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.escrow_vault.to_account_info(),
                        to: ctx.accounts.staking_rewards_vault.to_account_info(),
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
                staking_reward,
            )?;

            // Update staking pool reward balance
            ctx.accounts.staking_pool.reward_balance += staking_reward;
            msg!("Transferred {} tokens to staking rewards", staking_reward);
        }

        // Transfer the remaining tokens (after fee) to token creator
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
            amount_after_fee,
        )?;

        msg!("Transferred {} tokens from winning escrow to token creator (after {}% fee of {})",
            amount_after_fee, FEE_PERCENTAGE, fee_amount);

        Ok(())
    }

    pub fn refund_losing_escrow(ctx: Context<RefundLosingEscrow>) -> Result<()> {
        let proposal = &ctx.accounts.proposal;
        let escrow = &ctx.accounts.choice_escrow;
        let staking_pool = &mut ctx.accounts.staking_pool;

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

        // Get the fee collector from ProgramConfig or use default
        let fee_collector = get_fee_collector(ctx.accounts.program_config.as_ref());
        
        // Verify that the provided fee_collector account matches the expected address
        require!(
            ctx.accounts.fee_collector.key() == fee_collector,
            ErrorCode::InvalidFeeCollector
        );

        // Calculate fee (1% of the losing amount)
        let fee_amount = calculate_fee(escrow.locked_amount);
        let mut amount_after_fee = escrow.locked_amount - fee_amount;

        if fee_amount > 0 {
            // Calculate protocol fee (70% of fee) and staking reward (30% of fee)
            let protocol_fee = calculate_protocol_fee(fee_amount);
            let _staking_reward = calculate_staking_reward(fee_amount);

            // Transfer the protocol fee to the fee collector
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.escrow_vault.to_account_info(),
                        to: ctx.accounts.fee_collector_token_account.to_account_info(),
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
                protocol_fee,
            )?;

            msg!("Transferred {} tokens as protocol fee to collector", protocol_fee);

            // Transfer remaining fee automatically to staking rewards (since we're already sending to staking pool)
            // Note: No need to add to staking_reward as we're sending amount_after_fee directly to staking pool
        } else {
            // If no fee, send all to staking
            amount_after_fee = escrow.locked_amount;
        }

        // Transfer the remaining tokens to staking pool
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.escrow_vault.to_account_info(),
                    to: ctx.accounts.staking_vault.to_account_info(),
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
            amount_after_fee,
        )?;

        // Update staking pool total staked amount (only count the non-fee portion)
        staking_pool.total_staked_amount += amount_after_fee;

        msg!("Transferred {} tokens from losing escrow to staking pool (after {}% fee of {})",
            amount_after_fee, FEE_PERCENTAGE, fee_amount);

        Ok(())
    }

    // Staking Functions
    pub fn initialize_staking_pool(
        ctx: Context<InitializeStakingPool>,
        distribution_interval: i64,
    ) -> Result<()> {
        let staking_pool = &mut ctx.accounts.staking_pool;
        let token_registry = &ctx.accounts.token_registry;

        // Verify authority from token registry
        require!(
            token_registry.authority == ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );

        staking_pool.token_mint = token_registry.token_mint;
        staking_pool.reward_balance = 0;
        staking_pool.total_staked_amount = 0;
        staking_pool.last_distribution_time = Clock::get()?.unix_timestamp;
        staking_pool.distribution_interval = distribution_interval;

        msg!("Staking pool initialized for token: {}", token_registry.token_name);

        Ok(())
    }

    pub fn stake_tokens(
        ctx: Context<StakeTokens>,
        amount: u64,
    ) -> Result<()> {
        let staker_account = &mut ctx.accounts.staker_account;
        let current_time = Clock::get()?.unix_timestamp;
        
        // Check if amount is at least MIN_STAKING_AMOUNT for first-time stakers
        if staker_account.staked_amount == 0 {
            require!(
                amount >= MIN_STAKING_AMOUNT,
                ErrorCode::InsufficientStakingAmount
            );
        }

        // Get the fee collector from ProgramConfig or use default
        let fee_collector = get_fee_collector(ctx.accounts.program_config.as_ref());
        
        // Verify that the provided fee_collector account matches the expected address
        require!(
            ctx.accounts.fee_collector.key() == fee_collector,
            ErrorCode::InvalidFeeCollector
        );
        
        // Calculate fee (1% of the staked amount) - fee is ADDITIONAL, not deducted
        let fee_amount = calculate_fee(amount);

        if fee_amount > 0 {
            // Calculate protocol fee (70% of fee) and staking reward (30% of fee)
            let protocol_fee = calculate_protocol_fee(fee_amount);
            let staking_reward = calculate_staking_reward(fee_amount);

            // Transfer the protocol fee to the fee collector
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.staker_token_account.to_account_info(),
                        to: ctx.accounts.fee_collector_token_account.to_account_info(),
                        authority: ctx.accounts.staker.to_account_info(),
                    },
                ),
                protocol_fee,
            )?;

            msg!("Transferred {} tokens as protocol fee to collector", protocol_fee);

            // Transfer staking rewards (30% of fee)
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.staker_token_account.to_account_info(),
                        to: ctx.accounts.staking_rewards_vault.to_account_info(),
                        authority: ctx.accounts.staker.to_account_info(),
                    },
                ),
                staking_reward,
            )?;

            // Update staking pool reward balance
            ctx.accounts.staking_pool.reward_balance += staking_reward;
            msg!("Transferred {} tokens to staking rewards", staking_reward);
        }

        // Transfer the full amount to staking vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.staker_token_account.to_account_info(),
                    to: ctx.accounts.staking_vault.to_account_info(),
                    authority: ctx.accounts.staker.to_account_info(),
                },
            ),
            amount,
        )?;

        // Update staker account
        if staker_account.staked_amount == 0 {
            // First time staking
            staker_account.staker = ctx.accounts.staker.key();
            staker_account.token_mint = ctx.accounts.token_mint.key();
            staker_account.stake_start_time = current_time;
            staker_account.last_claim_time = current_time;
            staker_account.cumulative_rewards = 0;
            staker_account.auto_compound = false; // Default to not auto-compounding
        }

        staker_account.staked_amount += amount;

        // Update staking pool total staked amount
        ctx.accounts.staking_pool.total_staked_amount += amount;

        msg!("Staked {} tokens plus {} fee ({}% of the amount)", 
             amount, fee_amount, FEE_PERCENTAGE);

        Ok(())
    }

    pub fn unstake_tokens(
        ctx: Context<UnstakeTokens>,
        amount: u64,
    ) -> Result<()> {
        let staking_pool = &mut ctx.accounts.staking_pool;
        let staker_account = &mut ctx.accounts.staker_account;
        let current_time = Clock::get()?.unix_timestamp;
        
        // Create a mutable variable to track the unstake amount
        let mut unstake_amount = amount;

        // Check if staker has enough staked tokens
        require!(
            staker_account.staked_amount >= amount,
            ErrorCode::InsufficientStakedTokens
        );

        // Check minimum staking period
        require!(
            current_time - staker_account.stake_start_time >= MIN_STAKING_PERIOD,
            ErrorCode::MinimumStakingPeriodNotMet
        );

        // Claim any pending rewards first (manually implemented instead of calling claim_rewards)
        if staking_pool.total_staked_amount > 0 && staker_account.staked_amount > 0 {
            let reward_share = (staker_account.staked_amount as u128)
                .checked_mul(staking_pool.reward_balance as u128)
                .ok_or(ErrorCode::CalculationError)?
                .checked_div(staking_pool.total_staked_amount as u128)
                .ok_or(ErrorCode::CalculationError)? as u64;

            if reward_share > 0 {
                // Check if auto-compound is enabled
                if staker_account.auto_compound {
                    // When unstaking, we need to add the auto-compounded rewards to the unstake amount
                    // so the user gets them back
                    
                    // Update staking pool state
                    staking_pool.reward_balance = staking_pool.reward_balance
                        .checked_sub(reward_share)
                        .ok_or(ErrorCode::CalculationError)?;
                    
                    // Update staker account's cumulative rewards record
                    staker_account.cumulative_rewards = staker_account.cumulative_rewards
                        .checked_add(reward_share)
                        .ok_or(ErrorCode::CalculationError)?;
                    
                    // We will transfer the auto-compounded rewards together with the unstaked amount
                    // by increasing the unstake_amount variable instead of the parameter
                    unstake_amount = unstake_amount.checked_add(reward_share).ok_or(ErrorCode::CalculationError)?;
                    
                    msg!("Including {} auto-compounded tokens in unstake amount", reward_share);
                } else {
                    // Transfer rewards from rewards vault to staker
                    token::transfer(
                        CpiContext::new_with_signer(
                            ctx.accounts.token_program.to_account_info(),
                            token::Transfer {
                                from: ctx.accounts.staking_rewards_vault.to_account_info(),
                                to: ctx.accounts.staker_token_account.to_account_info(),
                                authority: ctx.accounts.rewards_vault_authority.to_account_info(),
                            },
                            &[&[
                                b"staking_rewards_vault_authority",
                                ctx.accounts.token_mint.key().as_ref(),
                                &[ctx.bumps.rewards_vault_authority]
                            ]],
                        ),
                        reward_share,
                    )?;

                    // Update reward balance
                    staking_pool.reward_balance -= reward_share;

                    // Update staker account
                    staker_account.last_claim_time = current_time;
                    staker_account.cumulative_rewards += reward_share;

                    msg!("Claimed {} tokens in rewards", reward_share);
                }
            }
        }

        // Transfer tokens from staking vault to staker
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.staking_vault.to_account_info(),
                    to: ctx.accounts.staker_token_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[&[
                    b"staking_vault_authority",
                    ctx.accounts.token_mint.key().as_ref(),
                    &[ctx.bumps.vault_authority]
                ]],
            ),
            unstake_amount,
        )?;

        // Update staker account
        staker_account.staked_amount -= amount;

        // Update staking pool
        staking_pool.total_staked_amount -= amount;

        msg!("Unstaked {} tokens", unstake_amount);

        Ok(())
    }

    pub fn claim_rewards(
        ctx: Context<ClaimRewards>,
    ) -> Result<()> {
        let staking_pool = &mut ctx.accounts.staking_pool;
        let staker_account = &mut ctx.accounts.staker_account;

        // Calculate rewards
        if staking_pool.total_staked_amount == 0 || staker_account.staked_amount == 0 {
            return Ok(());
        }

        let reward_share = (staker_account.staked_amount as u128)
            .checked_mul(staking_pool.reward_balance as u128)
            .ok_or(ErrorCode::CalculationError)?
            .checked_div(staking_pool.total_staked_amount as u128)
            .ok_or(ErrorCode::CalculationError)? as u64;

        if reward_share == 0 {
            return Ok(());
        }

        // Check if auto-compound is enabled
        if staker_account.auto_compound {
            // Instead of transferring rewards, add them to staked amount
            staker_account.staked_amount = staker_account.staked_amount
                .checked_add(reward_share)
                .ok_or(ErrorCode::CalculationError)?;
                
            // Update total staked amount in the pool
            staking_pool.total_staked_amount = staking_pool.total_staked_amount
                .checked_add(reward_share)
                .ok_or(ErrorCode::CalculationError)?;
            
            // Update reward balance
            staking_pool.reward_balance = staking_pool.reward_balance
                .checked_sub(reward_share)
                .ok_or(ErrorCode::CalculationError)?;
            
            // Update staker account
            staker_account.last_claim_time = Clock::get()?.unix_timestamp;
            staker_account.cumulative_rewards = staker_account.cumulative_rewards
                .checked_add(reward_share)
                .ok_or(ErrorCode::CalculationError)?;
            
            msg!("Auto-compounded {} tokens in rewards to staking principal", reward_share);
        } else {
            // Standard reward claiming - transfer to wallet
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.staking_rewards_vault.to_account_info(),
                        to: ctx.accounts.staker_token_account.to_account_info(),
                        authority: ctx.accounts.rewards_vault_authority.to_account_info(),
                    },
                    &[&[
                        b"staking_rewards_vault_authority",
                        ctx.accounts.token_mint.key().as_ref(),
                        &[ctx.bumps.rewards_vault_authority]
                    ]],
                ),
                reward_share,
            )?;

            // Update reward balance
            staking_pool.reward_balance -= reward_share;

            // Update staker account
            staker_account.last_claim_time = Clock::get()?.unix_timestamp;
            staker_account.cumulative_rewards += reward_share;

            msg!("Claimed {} tokens in rewards", reward_share);
        }

        Ok(())
    }

    pub fn distribute_staking_rewards(
        ctx: Context<DistributeStakingRewards>,
        amount: u64,
    ) -> Result<()> {
        let staking_pool = &mut ctx.accounts.staking_pool;
        let token_registry = &ctx.accounts.token_registry;

        // Verify authority from token registry
        require!(
            token_registry.authority == ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );

        // Transfer rewards to rewards vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.authority_token_account.to_account_info(),
                    to: ctx.accounts.staking_rewards_vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            amount,
        )?;

        // Update reward balance
        staking_pool.reward_balance += amount;
        staking_pool.last_distribution_time = Clock::get()?.unix_timestamp;

        msg!("Distributed {} tokens to staking rewards", amount);

        Ok(())
    }
    
    pub fn toggle_auto_compound(
        ctx: Context<ToggleAutoCompound>,
        enable: bool,
    ) -> Result<()> {
        let staker_account = &mut ctx.accounts.staker_account;
        
        // Security check: verify the staker is the signer
        require!(
            staker_account.staker == ctx.accounts.staker.key(),
            ErrorCode::Unauthorized
        );
        
        // Toggle auto compound setting
        staker_account.auto_compound = enable;
        
        msg!("Auto-compounding for staker {} is now {}", 
             ctx.accounts.staker.key(), 
             if enable { "enabled" } else { "disabled" });
        
        Ok(())
    }
    
    pub fn get_governance_settings(ctx: Context<GetGovernanceSettings>) -> Result<GovernanceSettings> {
        let governance = &ctx.accounts.governance;
        let token_registry = &ctx.accounts.token_registry;

        // Restrict access to the token creator
        require!(
            token_registry.authority == ctx.accounts.authority.key(),
            ErrorCode::Unauthorized
        );

        // Convert voting period from seconds back to days for the frontend
        let voting_period_days = governance.voting_period / SECONDS_PER_DAY;

        // Return governance settings
        Ok(GovernanceSettings {
            proposal_threshold_percentage: governance.proposal_threshold_percentage,
            proposal_threshold: governance.proposal_threshold,
            min_vote_threshold: governance.min_vote_threshold,
            voting_period_days: voting_period_days,
            is_active: governance.is_active,
            name: governance.name.clone(),
        })
    }
}

#[account]
pub struct StakingPool {
        pub token_mint: Pubkey,
        pub reward_balance: u64,
        pub total_staked_amount: u64,
        pub last_distribution_time: i64,
        pub distribution_interval: i64, // e.g., 604800 for weekly (in seconds)
    }

    impl StakingPool {
        pub const LEN: usize = 8  // discriminator
            + 32  // token_mint
            + 8   // reward_balance
            + 8   // total_staked_amount
            + 8   // last_distribution_time
            + 8;  // distribution_interval
    }

    #[account]
    pub struct StakerAccount {
        pub staker: Pubkey,
        pub token_mint: Pubkey,
        pub staked_amount: u64,
        pub stake_start_time: i64,
        pub last_claim_time: i64,
        pub cumulative_rewards: u64,
        pub auto_compound: bool,
    }

    impl StakerAccount {
        pub const LEN: usize = 8  // discriminator
            + 32  // staker
            + 32  // token_mint
            + 8   // staked_amount
            + 8   // stake_start_time
            + 8   // last_claim_time
            + 8   // cumulative_rewards
            + 1;  // auto_compound (boolean)
    }


// Constants
pub const MAX_CHOICES: usize = 10;

// Data Structures
// Token Registry Structures
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

#[derive(Accounts)]
#[instruction(amount: u64, choice_id: u8)]
pub struct LockTokensForChoice<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    #[account(
        mut,
        seeds = [b"proposal", proposal.governance.as_ref(), &proposal.id.to_le_bytes()],
        bump,
        constraint = proposal.status == ProposalStatus::Active
    )]
    pub proposal: Account<'info, MultiChoiceProposal>,

    /// where we store the locked-amount record
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

    /// this must be an Account<Mint>
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

    /// CHECK: Program config is optional, if not initialized will use default fee collector
    #[account(
        seeds = [b"program_config"],
        bump,
    )]
    pub program_config: Option<Account<'info, ProgramConfig>>,

    /// CHECK: Fee collector is derived from program_config or fallback to default
    pub fee_collector: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = fee_collector_token_account.owner == fee_collector.key(),
        constraint = fee_collector_token_account.mint == token_mint.key()
    )]
    pub fee_collector_token_account: Account<'info, TokenAccount>,

    /// Optional staking pool for rewards
    #[account(mut)]
    pub staking_pool: Option<Account<'info, StakingPool>>,

    /// Optional staking rewards vault
    #[account(mut)]
    pub staking_rewards_vault: Option<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(amount: u64, choice_id: u8)]
pub struct LockTokensForChoiceWithStakingBoost<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    #[account(
        mut,
        seeds = [b"proposal", proposal.governance.as_ref(), &proposal.id.to_le_bytes()],
        bump,
        constraint = proposal.status == ProposalStatus::Active
    )]
    pub proposal: Account<'info, MultiChoiceProposal>,

    /// where we store the locked-amount record
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

    /// this must be an Account<Mint>
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

    /// CHECK: Program config is optional, if not initialized will use default fee collector
    #[account(
        seeds = [b"program_config"],
        bump,
    )]
    pub program_config: Option<Account<'info, ProgramConfig>>,

    /// CHECK: Fee collector is derived from program_config or fallback to default
    pub fee_collector: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = fee_collector_token_account.owner == fee_collector.key(),
        constraint = fee_collector_token_account.mint == token_mint.key()
    )]
    pub fee_collector_token_account: Account<'info, TokenAccount>,

    /// Staking pool must exist for this instruction
    #[account(
        mut,
        seeds = [b"staking_pool", token_mint.key().as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,

    /// Staking rewards vault must exist for this instruction
    #[account(
        mut,
        seeds = [b"staking_rewards_vault", token_mint.key().as_ref()],
        bump
    )]
    pub staking_rewards_vault: Account<'info, TokenAccount>,

    /// Staker account for the voter, to check the staking status
    #[account(
        seeds = [
            b"staker_account",
            token_mint.key().as_ref(),
            voter.key().as_ref()
        ],
        bump,
        constraint = staker_account.staker == voter.key()
    )]
    pub staker_account: Account<'info, StakerAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

    pub fn get_governance_settings(ctx: Context<GetGovernanceSettings>) -> Result<GovernanceSettings> {
        let governance = &ctx.accounts.governance;
        let token_registry = &ctx.accounts.token_registry;

        // Restrict access to the token creator
        require!(
        token_registry.authority == ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );

        // Convert voting period from seconds back to days for the frontend
        let voting_period_days = governance.voting_period / SECONDS_PER_DAY;

        // Return governance settings
        Ok(GovernanceSettings {
            proposal_threshold_percentage: governance.proposal_threshold_percentage,
            proposal_threshold: governance.proposal_threshold,
            min_vote_threshold: governance.min_vote_threshold,
            voting_period_days: voting_period_days,
            is_active: governance.is_active,
            name: governance.name.clone(),
        })
    }

// Payload for updating governance settings via proposal
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateSettingsPayload {
    pub voting_period_days: i64,
    pub min_vote_threshold: u64,
    pub proposal_threshold: u64,
    pub proposal_threshold_percentage: u8,
}

// New struct to return governance settings
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct GovernanceSettings {
    pub proposal_threshold_percentage: u8,
    pub proposal_threshold: u64,
    pub min_vote_threshold: u64,
    pub voting_period_days: i64,  // Now returning days instead of seconds
    pub is_active: bool,
    pub name: String,
}

// Context for the new instruction
#[derive(Accounts)]
pub struct GetGovernanceSettings<'info> {
    pub authority: Signer<'info>,
    #[account(
    seeds = [b"token_registry", token_registry.token_mint.as_ref()],
    bump,
    constraint = token_registry.authority == authority.key()
    )]
    pub token_registry: Account<'info, TokenRegistry>,
    #[account(
    seeds = [b"governance", token_registry.token_mint.as_ref()],
    bump
    )]
    pub governance: Account<'info, Governance>,
}
#[account]
pub struct TokenRegistry {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub token_name: String,
    pub token_symbol: String,
    pub launch_timestamp: i64,
    pub pump_fun_id: String,
    pub governance_enabled: bool,
    pub is_initialized: bool,
}

impl TokenRegistry {
    pub const LEN: usize = 8    // discriminator
               + 32   // authority
               + 32   // token_mint
               // token_name = 4-byte prefix + up to 32 bytes
               + 4    // token_name length prefix
               + 32   // token_name data
               // token_symbol = 4-byte prefix + up to 8 bytes
               + 4    // token_symbol length prefix
               + 8    // token_symbol data
               + 8    // launch_timestamp
               // pump_fun_id = 4-byte prefix + up to 36 bytes
               + 4    // pump_fun_id length prefix
               + 36   // pump_fun_id data
               + 1    // governance_enabled
               + 1;   // is_initialized
}

/// On‑chain we only store the pointer to off‑chain JSON
#[account]
pub struct TokenMetadata {
    pub token_mint: Pubkey,
    /// URI to an IPFS/Arweave JSON, e.g. "ipfs://Qm…"
    pub metadata_uri: String,
}

impl TokenMetadata {
    pub const LEN: usize = 8     // discriminator
            + 32     // token_mint
            + 4      // string length prefix
            + 200;   // max URI length (adjustable)
}

// Governance Structures
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ProposalStatus {
    Active,
    Executed,
    Rejected,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ProposalExecutionType {
    UpdateSettings,
    AddModerator,
    CustomAction,
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
    pub proposal_threshold_percentage: u8, // New field: percentage of total supply needed to create a proposal
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
    pub execution_type: ProposalExecutionType,
    pub execution_payload: Vec<u8>,
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
        + 1   // execution_type (enum)
        + 4   // execution_payload length prefix
        + 100 // execution_payload (estimated)
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

// Context Structures
// Token Registry Contexts
#[derive(Accounts)]
pub struct RegisterCommunityToken<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = TokenRegistry::LEN,
        seeds = [b"token_registry", token_mint.key().as_ref()],
        bump
    )]
    pub token_registry: Account<'info, TokenRegistry>,

    pub token_mint: Account<'info, Mint>,

    /// CHECK: Program config is optional, if not initialized will use default fee collector
    #[account(
        seeds = [b"program_config"],
        bump,
    )]
    pub program_config: Option<Account<'info, ProgramConfig>>,

    /// CHECK: Fee collector is derived from program_config or fallback to default
    pub fee_collector: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub fee_collector_token_account: Account<'info, TokenAccount>,

    /// Optional staking pool for rewards
    #[account(mut)]
    pub staking_pool: Option<Account<'info, StakingPool>>,

    /// Optional staking rewards vault
    #[account(mut)]
    pub staking_rewards_vault: Option<Account<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UpdateRegistry<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"token_registry", token_registry.token_mint.as_ref()],
        bump,
        constraint = token_registry.authority == authority.key()
    )]
    pub token_registry: Account<'info, TokenRegistry>,
}

#[derive(Accounts)]
pub struct AddTokenMetadata<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"token_registry", token_registry.token_mint.as_ref()],
        bump,
        constraint = token_registry.authority == authority.key()
    )]
    pub token_registry: Account<'info, TokenRegistry>,

    #[account(
        init,
        payer = authority,
        space = TokenMetadata::LEN,
        seeds = [b"token_metadata", token_registry.token_mint.as_ref()],
        bump
    )]
    pub token_metadata: Account<'info, TokenMetadata>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct VerifyTokenOwnership<'info> {
    pub user: Signer<'info>,

    #[account(
        seeds = [b"token_registry", token_registry.token_mint.as_ref()],
        bump
    )]
    pub token_registry: Account<'info, TokenRegistry>,

    #[account(
        constraint = user_token_account.mint == token_registry.token_mint,
        constraint = user_token_account.owner == user.key()
    )]
    pub user_token_account: Account<'info, TokenAccount>,
}

// Governance Contexts
#[derive(Accounts)]
pub struct InitializeGovernance<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"token_registry", token_registry.token_mint.as_ref()],
        bump,
        constraint = token_registry.authority == authority.key()
    )]
    pub token_registry: Account<'info, TokenRegistry>,

    #[account(
        init,
        payer = authority,
        space = Governance::LEN,
        seeds = [b"governance", token_registry.token_mint.as_ref()],
        bump
    )]
    pub governance: Account<'info, Governance>,

    /// CHECK: Program config is optional, if not initialized will use default fee collector
    #[account(
        seeds = [b"program_config"],
        bump,
    )]
    pub program_config: Option<Account<'info, ProgramConfig>>,

    /// CHECK: Fee collector is derived from program_config or fallback to default
    pub fee_collector: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = fee_collector_token_account.owner == fee_collector.key(),
        constraint = fee_collector_token_account.mint == token_mint.key()
    )]
    pub fee_collector_token_account: Account<'info, TokenAccount>,

    /// Optional staking pool for rewards
    #[account(mut)]
    pub staking_pool: Option<Account<'info, StakingPool>>,

    /// Optional staking rewards vault
    #[account(mut)]
    pub staking_rewards_vault: Option<Account<'info, TokenAccount>>,

    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
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

    // Added token mint account to get total supply for percentage threshold check
    #[account(
        constraint = token_mint.key() == governance.token_mint
    )]
    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = proposer_token_account.mint == governance.token_mint,
        constraint = proposer_token_account.owner == proposer.key()
    )]
    pub proposer_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = proposer,
        // Space calculation is dynamic based on number of choices
        space = 8 + MultiChoiceProposal::space(MAX_CHOICES),
        seeds = [b"proposal", governance.key().as_ref(), &governance.proposal_count.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, MultiChoiceProposal>,

    /// CHECK: Program config is optional, if not initialized will use default fee collector
    #[account(
        seeds = [b"program_config"],
        bump,
    )]
    pub program_config: Option<Account<'info, ProgramConfig>>,

    /// CHECK: Fee collector is derived from program_config or fallback to default
    pub fee_collector: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = fee_collector_token_account.owner == fee_collector.key(),
        constraint = fee_collector_token_account.mint == governance.token_mint
    )]
    pub fee_collector_token_account: Account<'info, TokenAccount>,

    /// Optional staking pool for rewards
    #[account(mut)]
    pub staking_pool: Option<Account<'info, StakingPool>>,

    /// Optional staking rewards vault
    #[account(mut)]
    pub staking_rewards_vault: Option<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,
    
    #[account(
        mut, // Make governance account mutable to allow updates
        seeds = [b"governance", governance.token_mint.as_ref()],
        bump
    )]
    pub governance: Account<'info, Governance>,
    
    #[account(
        seeds = [b"token_registry", token_registry.token_mint.as_ref()],
        bump,
        constraint = token_registry.token_mint == governance.token_mint
    )]
    pub token_registry: Account<'info, TokenRegistry>,
    
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
        constraint = executor.key() == proposal.token_creator
            @ ErrorCode::Unauthorized
    )]
    pub executor: Signer<'info>,
    #[account(
        seeds = [b"proposal", proposal.governance.as_ref(), &proposal.id.to_le_bytes()],
        bump,
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
    
    /// CHECK: Program config is optional, if not initialized will use default fee collector
    #[account(
        seeds = [b"program_config"],
        bump,
    )]
    pub program_config: Option<Account<'info, ProgramConfig>>,

    /// CHECK: Fee collector is derived from program_config or fallback to default
    pub fee_collector: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = fee_collector_token_account.owner == fee_collector.key(),
        constraint = fee_collector_token_account.mint == token_mint.key()
    )]
    pub fee_collector_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"staking_pool", token_mint.key().as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    #[account(
        mut,
        seeds = [
            b"staking_rewards_vault",
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub staking_rewards_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefundLosingEscrow<'info> {
    #[account(
        mut,
        constraint = executor.key() == proposal.token_creator
            @ ErrorCode::Unauthorized
    )]
    pub executor: Signer<'info>,
    #[account(
        seeds = [b"proposal", proposal.governance.as_ref(), &proposal.id.to_le_bytes()],
        bump,
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
    // We're keeping this for validation, though we won't be transferring tokens back to the voter
    #[account(
        constraint = voter_token_account.owner == choice_escrow.voter,
        constraint = voter_token_account.mint == token_mint.key()
    )]
    pub voter_token_account: Account<'info, TokenAccount>,
    pub token_mint: Account<'info, Mint>,
    
    /// CHECK: Program config is optional, if not initialized will use default fee collector
    #[account(
        seeds = [b"program_config"],
        bump,
    )]
    pub program_config: Option<Account<'info, ProgramConfig>>,

    /// CHECK: Fee collector is derived from program_config or fallback to default
    pub fee_collector: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = fee_collector_token_account.owner == fee_collector.key(),
        constraint = fee_collector_token_account.mint == token_mint.key()
    )]
    pub fee_collector_token_account: Account<'info, TokenAccount>,
    
    // Adding staking pool accounts
    #[account(
        mut,
        seeds = [b"staking_pool", token_mint.key().as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,
    
    /// CHECK: This is a PDA used as token account authority for the staking vault
    #[account(
        seeds = [
            b"staking_vault_authority",
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub staking_vault_authority: UncheckedAccount<'info>,
    
    #[account(
        mut,
        seeds = [
            b"staking_vault",
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub staking_vault: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

// Staking Contexts
#[derive(Accounts)]
pub struct InitializeStakingPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"token_registry", token_registry.token_mint.as_ref()],
        bump,
        constraint = token_registry.authority == authority.key()
    )]
    pub token_registry: Account<'info, TokenRegistry>,

    #[account(
        init,
        payer = authority,
        space = StakingPool::LEN,
        seeds = [b"staking_pool", token_registry.token_mint.as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,

    /// CHECK: This is a PDA used as token account authority
    #[account(
        seeds = [
            b"staking_vault_authority",
            token_registry.token_mint.as_ref()
        ],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        token::mint = token_mint,
        token::authority = vault_authority,
        seeds = [
            b"staking_vault",
            token_registry.token_mint.as_ref()
        ],
        bump
    )]
    pub staking_vault: Account<'info, TokenAccount>,

    /// CHECK: This is a PDA used as token account authority
    #[account(
        seeds = [
            b"staking_rewards_vault_authority",
            token_registry.token_mint.as_ref()
        ],
        bump
    )]
    pub rewards_vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        token::mint = token_mint,
        token::authority = rewards_vault_authority,
        seeds = [
            b"staking_rewards_vault",
            token_registry.token_mint.as_ref()
        ],
        bump
    )]
    pub staking_rewards_vault: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct StakeTokens<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"staking_pool", token_mint.key().as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,

    #[account(
        init,
        payer = staker,
        space = StakerAccount::LEN,
        seeds = [
            b"staker_account",
            token_mint.key().as_ref(),
            staker.key().as_ref()
        ],
        bump
    )]
    pub staker_account: Account<'info, StakerAccount>,

    #[account(
        mut,
        constraint = staker_token_account.owner == staker.key(),
        constraint = staker_token_account.mint == token_mint.key()
    )]
    pub staker_token_account: Account<'info, TokenAccount>,

    /// CHECK: This is a PDA used as token account authority
    #[account(
        seeds = [
            b"staking_vault_authority",
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [
            b"staking_vault",
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub staking_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [
            b"staking_rewards_vault",
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub staking_rewards_vault: Account<'info, TokenAccount>,

    /// CHECK: Program config is optional, if not initialized will use default fee collector
    #[account(
        seeds = [b"program_config"],
        bump,
    )]
    pub program_config: Option<Account<'info, ProgramConfig>>,

    /// CHECK: Fee collector is derived from program_config or fallback to default
    pub fee_collector: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = fee_collector_token_account.owner == fee_collector.key(),
        constraint = fee_collector_token_account.mint == token_mint.key()
    )]
    pub fee_collector_token_account: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct UnstakeTokens<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"staking_pool", token_mint.key().as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,

    #[account(
        mut,
        seeds = [
            b"staker_account",
            token_mint.key().as_ref(),
            staker.key().as_ref()
        ],
        bump,
        constraint = staker_account.staker == staker.key()
    )]
    pub staker_account: Account<'info, StakerAccount>,

    #[account(
        mut,
        constraint = staker_token_account.owner == staker.key(),
        constraint = staker_token_account.mint == token_mint.key()
    )]
    pub staker_token_account: Account<'info, TokenAccount>,

    /// CHECK: This is a PDA used as token account authority
    #[account(
        seeds = [
            b"staking_vault_authority",
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [
            b"staking_vault",
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub staking_vault: Account<'info, TokenAccount>,

    /// CHECK: This is a PDA used as token account authority
    #[account(
        seeds = [
            b"staking_rewards_vault_authority",
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub rewards_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [
            b"staking_rewards_vault",
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub staking_rewards_vault: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"staking_pool", token_mint.key().as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,

    #[account(
        mut,
        seeds = [
            b"staker_account",
            token_mint.key().as_ref(),
            staker.key().as_ref()
        ],
        bump,
        constraint = staker_account.staker == staker.key()
    )]
    pub staker_account: Account<'info, StakerAccount>,

    #[account(
        mut,
        constraint = staker_token_account.owner == staker.key(),
        constraint = staker_token_account.mint == token_mint.key()
    )]
    pub staker_token_account: Account<'info, TokenAccount>,

    /// CHECK: This is a PDA used as token account authority
    #[account(
        seeds = [
            b"staking_rewards_vault_authority",
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub rewards_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [
            b"staking_rewards_vault",
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub staking_rewards_vault: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DistributeStakingRewards<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"token_registry", token_mint.key().as_ref()],
        bump,
        constraint = token_registry.is_initialized
    )]
    pub token_registry: Account<'info, TokenRegistry>,

    #[account(
        mut,
        seeds = [b"staking_pool", token_mint.key().as_ref()],
        bump
    )]
    pub staking_pool: Account<'info, StakingPool>,

    #[account(
        mut,
        constraint = authority_token_account.owner == authority.key(),
        constraint = authority_token_account.mint == token_mint.key()
    )]
    pub authority_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [
            b"staking_rewards_vault",
            token_mint.key().as_ref()
        ],
        bump
    )]
    pub staking_rewards_vault: Account<'info, TokenAccount>,

    pub token_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ToggleAutoCompound<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,
    
    #[account(
        mut,
        seeds = [
            b"staker_account",
            token_mint.key().as_ref(),
            staker.key().as_ref()
        ],
        bump,
        constraint = staker_account.staker == staker.key()
    )]
    pub staker_account: Account<'info, StakerAccount>,
    
    pub token_mint: Account<'info, Mint>,
}

// Program Configuration Contexts
#[derive(Accounts)]
pub struct InitializeProgramConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = ProgramConfig::LEN,
        seeds = [b"program_config"],
        bump
    )]
    pub program_config: Account<'info, ProgramConfig>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct UpdateFeeCollector<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"program_config"],
        bump,
        constraint = program_config.is_initialized
    )]
    pub program_config: Account<'info, ProgramConfig>,
}

#[account]
pub struct ProgramConfig {
    pub admin: Pubkey,
    pub fee_collector: Pubkey,
    pub is_initialized: bool,
}

impl ProgramConfig {
    pub const LEN: usize = 8  // discriminator
        + 32  // admin
        + 32  // fee_collector
        + 1;  // is_initialized
}

/// Derives the program config PDA address
pub fn get_program_config_address() -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[b"program_config"],
        &crate::ID
    )
}

/// Getter function for fee collector - checks ProgramConfig account if it exists,
/// otherwise falls back to DEFAULT_FEE_COLLECTOR
pub fn get_fee_collector(program_config: Option<&Account<ProgramConfig>>) -> Pubkey {
    match program_config {
        Some(config) if config.is_initialized => config.fee_collector,
        _ => DEFAULT_FEE_COLLECTOR,
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("You are not authorized to perform this action")]
    Unauthorized,
    #[msg("User does not hold any tokens")]
    NoTokensHeld,
    #[msg("Governance is not active")]
    GovernanceInactive,
    #[msg("Governance is disabled for this token")]
    GovernanceDisabled,
    #[msg("Proposal is not active")]
    ProposalNotActive,
    #[msg("Voting period has ended")]
    VotingEnded,
    #[msg("Voting period has not ended yet")]
    VotingNotEnded,
    #[msg("Insufficient tokens")]
    InsufficientTokens,
    #[msg("You need more tokens to open a proposal")]
    ProposalThresholdNotMet,
    #[msg("Invalid choice ID")]
    InvalidChoiceId,
    #[msg("Invalid choices count")]
    InvalidChoicesCount,
    #[msg("Too many choices")]
    TooManyChoices,
    #[msg("Vote threshold not met")]
    VoteThresholdNotMet,
    #[msg("Proposal not executed")]
    ProposalNotExecuted,
    #[msg("No winning choice determined")]
    NoWinningChoice,
    #[msg("Not the winning escrow")]
    NotWinningEscrow,
    #[msg("Cannot refund the winning escrow")]
    IsWinningEscrow,
    #[msg("Invalid threshold percentage (must be between 0-100)")]
    InvalidThresholdPercentage,
    #[msg("Percentage threshold not met to create proposal")]
    PercentageThresholdNotMet,
    #[msg("Insufficient staked tokens")]
    InsufficientStakedTokens,
    #[msg("Minimum staking period not met")]
    MinimumStakingPeriodNotMet,
    #[msg("Calculation error")]
    CalculationError,
    #[msg("No staked tokens found for vote power boost")]
    NoStakedTokens,
    #[msg("Program config already initialized")]
    ConfigAlreadyInitialized,
    #[msg("Invalid fee collector account")]
    InvalidFeeCollector,
    #[msg("Invalid proposal payload format")]
    InvalidPayload,
    #[msg("Invalid governance settings")]
    InvalidGovernanceSettings,
    #[msg("Staking amount must be at least the minimum amount")]
    InsufficientStakingAmount,
}
