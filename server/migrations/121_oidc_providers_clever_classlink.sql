-- Extend OIDC identity + flow state for Clever (linked id) and ClassLink (plan 4.4).

ALTER TABLE settings.user_oidc_identities DROP CONSTRAINT IF EXISTS user_oidc_identities_provider_check;
ALTER TABLE settings.user_oidc_identities
    ADD CONSTRAINT user_oidc_identities_provider_check
    CHECK (provider IN ('google', 'microsoft', 'apple', 'custom', 'classlink', 'clever'));
