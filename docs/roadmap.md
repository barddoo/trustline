# Roadmap

Trustline now ships the initial provider, client, middleware, and storage adapters. This page covers the work that is still planned beyond the current release.

## Current status

- Implemented now: provider, client, guard, memory storage, SQLite storage, and Express/Fastify/Hono adapters
- Implemented Phase 1 controls: key rotation overlap windows, token revocation, narrower scope requests, and client disable/token cutoff controls
- Planned next: client secret rotation, richer client management, audit hooks, pluggable client caches, and broader operational controls

## Planned security and operations work

Later phases in the project brief include:

- stronger provider mount-path guidance for root JWKS publishing
- broader integration coverage across runtimes

## Planned ecosystem work

The core design is framework-agnostic and based on standard request and response primitives. The current implementation already includes Express, Fastify, and Hono support. Future work is mostly around deeper runtime coverage and operational features rather than basic adapter availability.
