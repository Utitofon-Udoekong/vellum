# Vellum task runner

set shell := ["powershell", "-NoProfile", "-Command"]

default:
    @just --list

setup:
    rustup target add wasm32v1-none
    pnpm install

circuit-build:
    wsl -e bash /mnt/c/Users/utito/Documents/projects/hackathons/vellum/scripts/build-circuits-wsl.sh

toolchain-install:
    wsl -e bash /mnt/c/Users/utito/Documents/projects/hackathons/vellum/scripts/install-toolchain-wsl.sh

contract-build:
    cargo build -p vellum_verifier -p vellum_pool --target wasm32v1-none --release

contract-test:
    cargo test -p vellum_verifier -p vellum_pool --release

contract-test-full:
    cargo test -p vellum_verifier -p vellum_pool --release --features circuit-artifacts

start:
    docker run -d -p 8000:8000 stellar/quickstart --local --limits unlimited --enable core,rpc,lab,horizon,friendbot

stop:
    stellar container stop

deploy:
    just circuit-build
    just contract-build
    powershell -ExecutionPolicy Bypass -File scripts/deploy.ps1

e2e:
    just circuit-build
    just contract-test-full
    just contract-build
    powershell -ExecutionPolicy Bypass -File scripts/e2e_local.ps1

demo-prep:
    pnpm demo:prep

demo-dev:
    pnpm dev
