use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};
use vellum_pool::{BatchStatus, VellumPool, VellumPoolClient};

fn setup_pool(
    env: &Env,
) -> (
    VellumPoolClient<'_>,
    Address,
    Address,
    soroban_sdk::testutils::StellarAssetContract,
) {
    let admin = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    let withdraw_verifier = Address::generate(env);
    let batch_verifier = Address::generate(env);

    let pool_id = env.register(
        VellumPool,
        (
            admin.clone(),
            token.clone(),
            withdraw_verifier,
            batch_verifier,
        ),
    );
    let client = VellumPoolClient::new(env, &pool_id);
    (client, admin, token, sac)
}

#[test]
fn deposit_three_commitments_increments_count() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    env.mock_all_auths();

    let (client, _, _, _) = setup_pool(&env);

    let c1 = BytesN::from_array(&env, &[11u8; 32]);
    let c2 = BytesN::from_array(&env, &[22u8; 32]);
    let c3 = BytesN::from_array(&env, &[33u8; 32]);

    assert_eq!(client.deposit(&c1), 0);
    assert_eq!(client.deposit(&c2), 1);
    assert_eq!(client.deposit(&c3), 2);
    assert_eq!(client.commitment_count(), 3);
    assert!(client.get_root().is_some());
    assert_eq!(client.get_batch_status(), BatchStatus::Building);
}

#[test]
fn duplicate_commitment_rejected() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    env.mock_all_auths();

    let (client, _, _, _) = setup_pool(&env);
    let c = BytesN::from_array(&env, &[44u8; 32]);
    client.deposit(&c);
    let err = client.try_deposit(&c).expect_err("duplicate");
    assert_eq!(err, Ok(vellum_pool::contract::PoolError::CommitmentExists));
}
