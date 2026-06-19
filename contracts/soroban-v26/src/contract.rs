extern crate alloc;

use crate::merkle;
use soroban_sdk::{
    address_payload::AddressPayload, contract, contracterror, contractevent, contractimpl,
    contracttype, symbol_short, Address, Bytes, BytesN, Env, IntoVal, InvokeError, Symbol,
    Vec as SorobanVec,
};
const PROOF_BYTES: usize = 456 * 32;

#[contract]
pub struct VellumPool;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum BatchStatus {
    Building = 0,
    Finalized = 1,
}

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum PoolError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    BatchFinalized = 4,
    BatchNotFinalized = 5,
    CommitmentExists = 6,
    TreeFull = 7,
    InvalidPublicInputs = 8,
    NullifierUsed = 9,
    RootMismatch = 10,
    VerificationFailed = 11,
    VerifierNotSet = 12,
    TotalMismatch = 13,
    InsufficientEscrow = 14,
    InvalidAmount = 15,
    InvalidRecipient = 16,
}

#[contractevent(topics = ["commit"], data_format = "map")]
pub struct CommitmentDepositedEvent<'a> {
    #[topic]
    pub idx: &'a u32,
    pub commitment: &'a BytesN<32>,
}

#[contractevent(topics = ["finalized"], data_format = "map")]
pub struct BatchFinalizedEvent<'a> {
    pub root: &'a BytesN<32>,
    pub total_amount: &'a i128,
    pub commitment_count: &'a u32,
}

#[contractevent(topics = ["withdraw"], data_format = "single-value")]
pub struct WithdrawEvent<'a> {
    pub nullifier_hash: &'a BytesN<32>,
}

fn key_admin() -> Symbol {
    symbol_short!("admin")
}
fn key_token() -> Symbol {
    symbol_short!("token")
}
fn key_withdraw_verifier() -> Symbol {
    symbol_short!("wver")
}
fn key_batch_verifier() -> Symbol {
    symbol_short!("bver")
}
fn key_status() -> Symbol {
    symbol_short!("status")
}
fn key_finalized_root() -> Symbol {
    symbol_short!("froot")
}
fn key_total_deposited() -> Symbol {
    symbol_short!("total")
}
fn key_total_withdrawn() -> Symbol {
    symbol_short!("wdrawn")
}
fn key_commitment_prefix() -> Symbol {
    symbol_short!("cm")
}
fn key_nullifier_prefix() -> Symbol {
    symbol_short!("nf")
}

const WITHDRAW_PUBLIC_INPUTS_LEN: u32 = 128;
const BATCH_SUM_PUBLIC_INPUTS_LEN: u32 = 32;

fn parse_withdraw_public_inputs(
    bytes: &Bytes,
) -> Result<([u8; 32], [u8; 32], [u8; 32], [u8; 32]), PoolError> {
    if bytes.len() != WITHDRAW_PUBLIC_INPUTS_LEN {
        return Err(PoolError::InvalidPublicInputs);
    }
    let mut buf = [0u8; 128];
    bytes.copy_into_slice(&mut buf);
    let mut root = [0u8; 32];
    let mut nullifier_hash = [0u8; 32];
    let mut amount = [0u8; 32];
    let mut recipient_id = [0u8; 32];
    root.copy_from_slice(&buf[..32]);
    nullifier_hash.copy_from_slice(&buf[32..64]);
    amount.copy_from_slice(&buf[64..96]);
    recipient_id.copy_from_slice(&buf[96..128]);
    Ok((root, nullifier_hash, amount, recipient_id))
}

fn recipient_id_from_address(env: &Env, employee: &Address) -> Result<BytesN<32>, PoolError> {
    match employee.to_payload() {
        Some(AddressPayload::AccountIdPublicKeyEd25519(pk)) => {
            Ok(merkle::recipient_id_from_ed25519_pubkey(env, &pk))
        }
        _ => Err(PoolError::InvalidRecipient),
    }
}

fn parse_batch_total(bytes: &Bytes) -> Result<[u8; 32], PoolError> {
    if bytes.len() != BATCH_SUM_PUBLIC_INPUTS_LEN {
        return Err(PoolError::InvalidPublicInputs);
    }
    let mut buf = [0u8; 32];
    bytes.copy_into_slice(&mut buf);
    Ok(buf)
}

fn field_bytes_to_u128(amount_field: &[u8; 32]) -> Result<u128, PoolError> {
    let mut value: u128 = 0;
    for byte in amount_field.iter() {
        value = value
            .checked_mul(256)
            .and_then(|v| v.checked_add(*byte as u128))
            .ok_or(PoolError::InvalidAmount)?;
    }
    if value > i128::MAX as u128 {
        return Err(PoolError::InvalidAmount);
    }
    Ok(value)
}

fn verify_proof(
    env: &Env,
    verifier: &Address,
    public_inputs: Bytes,
    proof_bytes: Bytes,
) -> Result<(), PoolError> {
    let mut args: SorobanVec<soroban_sdk::Val> = SorobanVec::new(env);
    args.push_back(public_inputs.into_val(env));
    args.push_back(proof_bytes.into_val(env));
    env.try_invoke_contract::<(), InvokeError>(
        verifier,
        &Symbol::new(env, "verify_proof"),
        args,
    )
    .map_err(|_| PoolError::VerificationFailed)?
    .map_err(|_| PoolError::VerificationFailed)
}

#[contractimpl]
impl VellumPool {
    pub fn __constructor(
        env: Env,
        admin: Address,
        token: Address,
        withdraw_verifier: Address,
        batch_verifier: Address,
    ) -> Result<(), PoolError> {
        if env.storage().instance().has(&key_admin()) {
            return Err(PoolError::AlreadyInitialized);
        }
        env.storage().instance().set(&key_admin(), &admin);
        env.storage().instance().set(&key_token(), &token);
        env.storage()
            .instance()
            .set(&key_withdraw_verifier(), &withdraw_verifier);
        env.storage()
            .instance()
            .set(&key_batch_verifier(), &batch_verifier);
        env.storage()
            .instance()
            .set(&key_status(), &BatchStatus::Building);
        env.storage().instance().set(&key_total_withdrawn(), &0i128);
        Ok(())
    }

    pub fn deposit(env: Env, commitment: BytesN<32>) -> Result<u32, PoolError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&key_admin())
            .ok_or(PoolError::NotInitialized)?;
        admin.require_auth();

        let status: BatchStatus = env
            .storage()
            .instance()
            .get(&key_status())
            .unwrap_or(BatchStatus::Building);
        if status == BatchStatus::Finalized {
            return Err(PoolError::BatchFinalized);
        }

        let cm_key = (key_commitment_prefix(), commitment.clone());
        if env.storage().instance().has(&cm_key) {
            return Err(PoolError::CommitmentExists);
        }

        let idx = merkle::insert_commitment(&env, commitment.clone()).map_err(|_| PoolError::TreeFull)?;
        env.storage().instance().set(&cm_key, &true);

        CommitmentDepositedEvent {
            idx: &idx,
            commitment: &commitment,
        }
        .publish(&env);

        Ok(idx)
    }

    pub fn finalize_batch(
        env: Env,
        total_amount: i128,
        sum_public_inputs: Bytes,
        sum_proof: Bytes,
    ) -> Result<(), PoolError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&key_admin())
            .ok_or(PoolError::NotInitialized)?;
        admin.require_auth();

        let status: BatchStatus = env
            .storage()
            .instance()
            .get(&key_status())
            .unwrap_or(BatchStatus::Building);
        if status == BatchStatus::Finalized {
            return Err(PoolError::BatchFinalized);
        }

        if sum_proof.len() as usize != PROOF_BYTES {
            return Err(PoolError::VerificationFailed);
        }

        let batch_verifier: Address = env
            .storage()
            .instance()
            .get(&key_batch_verifier())
            .ok_or(PoolError::VerifierNotSet)?;
        verify_proof(&env, &batch_verifier, sum_public_inputs.clone(), sum_proof)?;

        let total_field = parse_batch_total(&sum_public_inputs)?;
        let proved_total = field_bytes_to_u128(&total_field)? as i128;
        if proved_total != total_amount {
            return Err(PoolError::TotalMismatch);
        }

        let token: Address = env
            .storage()
            .instance()
            .get(&key_token())
            .ok_or(PoolError::NotInitialized)?;
        let contract_addr = env.current_contract_address();
        let token_client = soroban_sdk::token::Client::new(&env, &token);
        token_client.transfer(&admin, &contract_addr, &total_amount);

        let root: BytesN<32> = merkle::get_root(&env).ok_or(PoolError::RootMismatch)?;
        let count = merkle::commitment_count(&env);

        env.storage().instance().set(&key_finalized_root(), &root);
        env.storage().instance().set(&key_total_deposited(), &total_amount);
        env.storage()
            .instance()
            .set(&key_status(), &BatchStatus::Finalized);

        BatchFinalizedEvent {
            root: &root,
            total_amount: &total_amount,
            commitment_count: &count,
        }
        .publish(&env);

        Ok(())
    }

    pub fn withdraw(
        env: Env,
        employee: Address,
        public_inputs: Bytes,
        proof_bytes: Bytes,
    ) -> Result<(), PoolError> {
        employee.require_auth();

        let status: BatchStatus = env
            .storage()
            .instance()
            .get(&key_status())
            .ok_or(PoolError::NotInitialized)?;
        if status != BatchStatus::Finalized {
            return Err(PoolError::BatchNotFinalized);
        }

        if proof_bytes.len() as usize != PROOF_BYTES {
            return Err(PoolError::VerificationFailed);
        }

        let (root_arr, nf_arr, amount_arr, recipient_id_arr) =
            parse_withdraw_public_inputs(&public_inputs)?;

        let nullifier_hash = BytesN::from_array(&env, &nf_arr);
        let nf_key = (key_nullifier_prefix(), nullifier_hash.clone());
        if env.storage().instance().has(&nf_key) {
            return Err(PoolError::NullifierUsed);
        }

        let root_from_proof = BytesN::from_array(&env, &root_arr);
        let finalized_root: BytesN<32> = env
            .storage()
            .instance()
            .get(&key_finalized_root())
            .ok_or(PoolError::RootMismatch)?;
        if finalized_root != root_from_proof {
            return Err(PoolError::RootMismatch);
        }

        let expected_recipient = recipient_id_from_address(&env, &employee)?;
        let recipient_from_proof = BytesN::from_array(&env, &recipient_id_arr);
        if expected_recipient != recipient_from_proof {
            return Err(PoolError::InvalidRecipient);
        }

        let withdraw_verifier: Address = env
            .storage()
            .instance()
            .get(&key_withdraw_verifier())
            .ok_or(PoolError::VerifierNotSet)?;
        verify_proof(&env, &withdraw_verifier, public_inputs, proof_bytes)?;

        let amount = field_bytes_to_u128(&amount_arr)? as i128;

        let total_deposited: i128 = env
            .storage()
            .instance()
            .get(&key_total_deposited())
            .unwrap_or(0);
        let total_withdrawn: i128 = env
            .storage()
            .instance()
            .get(&key_total_withdrawn())
            .unwrap_or(0);
        if total_withdrawn.saturating_add(amount) > total_deposited {
            return Err(PoolError::InsufficientEscrow);
        }

        env.storage().instance().set(&nf_key, &true);
        env.storage()
            .instance()
            .set(&key_total_withdrawn(), &(total_withdrawn + amount));

        let token: Address = env
            .storage()
            .instance()
            .get(&key_token())
            .ok_or(PoolError::NotInitialized)?;
        let contract_addr = env.current_contract_address();
        let token_client = soroban_sdk::token::Client::new(&env, &token);
        token_client.transfer(&contract_addr, &employee, &amount);

        WithdrawEvent {
            nullifier_hash: &nullifier_hash,
        }
        .publish(&env);

        Ok(())
    }

    pub fn get_root(env: Env) -> Option<BytesN<32>> {
        merkle::get_root(&env)
    }

    pub fn get_finalized_root(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&key_finalized_root())
    }

    pub fn get_batch_status(env: Env) -> Result<BatchStatus, PoolError> {
        env.storage()
            .instance()
            .get(&key_status())
            .ok_or(PoolError::NotInitialized)
    }

    pub fn commitment_count(env: Env) -> u32 {
        merkle::commitment_count(&env)
    }

    pub fn is_nullifier_used(env: Env, nullifier_hash: BytesN<32>) -> bool {
        let nf_key = (key_nullifier_prefix(), nullifier_hash);
        env.storage().instance().has(&nf_key)
    }

    pub fn total_deposited(env: Env) -> Result<i128, PoolError> {
        env.storage()
            .instance()
            .get(&key_total_deposited())
            .ok_or(PoolError::NotInitialized)
    }

    pub fn total_withdrawn(env: Env) -> Result<i128, PoolError> {
        env.storage()
            .instance()
            .get(&key_total_withdrawn())
            .ok_or(PoolError::NotInitialized)
    }
}

#[cfg(test)]
#[contractimpl]
impl VellumPool {
    pub fn reset_for_test(env: Env) -> Result<(), PoolError> {
        merkle::reset_tree(&env);
        env.storage().instance().set(&key_status(), &BatchStatus::Building);
        env.storage().instance().remove(&key_finalized_root());
        env.storage().instance().remove(&key_total_deposited());
        env.storage().instance().set(&key_total_withdrawn(), &0i128);
        Ok(())
    }
}
