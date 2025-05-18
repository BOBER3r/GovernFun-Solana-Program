import {Program, AnchorProvider, web3} from "@coral-xyz/anchor";
import idl from "../target/idl/community_token_launcher.json";

async function registerToken() {
    // Set up connection and provider
    const connection = new web3.Connection("https://api.devnet.solana.com", "confirmed");
    const wallet = web3.Keypair.generate(); // Replace with a real wallet
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    const programId = new web3.PublicKey("4SUWJsjPC5o9QMz47QcSmE4EP6EYAn9xyevAAXaGAmjT");
    const program = new Program(idl, programId, provider);

    try {
        // Define the token mint public key
        const tokenMint = new web3.PublicKey("YOUR_TOKEN_MINT_ADDRESS_HERE");

        // Derive the tokenRegistry PDA
        const [tokenRegistryPubkey, bump] = await web3.PublicKey.findProgramAddress(
            [
                Buffer.from("token_registry"),
                tokenMint.toBuffer(),
            ],
            programId
        );

        // Define other required accounts (e.g., program_config, fee_collector)
        const [programConfigPubkey] = await web3.PublicKey.findProgramAddress(
            [Buffer.from("program_config")],
            programId
        );
        const feeCollector = new web3.PublicKey("YOUR_FEE_COLLECTOR_ADDRESS_HERE"); // Replace
        const authorityTokenAccount = /* Derive or find ATA for wallet and tokenMint */;
        const feeCollectorTokenAccount = /* Derive or find ATA for feeCollector and tokenMint */;

        // Call registerCommunityToken
        await program.methods
            .registerCommunityToken(
                "My Token",
                "MTK",
                Math.floor(Date.now() / 1000), // launch_timestamp
                "pump_fun_id_example",
                true, // governance_enabled
                new web3.BN(1000000) // registration_fee (in lamports)
            )
            .accounts({
                authority: wallet.publicKey,
                tokenRegistry: tokenRegistryPubkey,
                tokenMint: tokenMint,
                programConfig: programConfigPubkey,
                feeCollector: feeCollector,
                authorityTokenAccount: authorityTokenAccount,
                feeCollectorTokenAccount: feeCollectorTokenAccount,
                systemProgram: web3.SystemProgram.programId,
                rent: web3.SYSVAR_RENT_PUBKEY,
                tokenProgram: new web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            })
            .signers([wallet])
            .rpc();

        console.log("Token registered successfully!");
        // Fetch to verify
        const tokenRegistry = await program.account.tokenRegistry.fetch(tokenRegistryPubkey);
        console.log("Token Registry Data:", tokenRegistry);
    } catch (error) {
        console.error("Error:", error);
    }
}

registerToken();