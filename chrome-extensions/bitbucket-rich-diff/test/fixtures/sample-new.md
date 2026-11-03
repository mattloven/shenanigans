# Payments Service

The payments service handles card authorisation, capture and settlement for all storefronts.
It is owned by the **Checkout Platform** team and runs in four regions.

![Architecture](docs/architecture.png)

## Getting started

1. Clone the repository.
2. Run `make setup` to install dependencies and git hooks.
3. Copy `.env.example` to `.env`.
4. Start the stack with `docker compose up`.

> **Note:** You need access to the staging vault before running locally. Request it in #access.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP port |
| `DB_POOL` | `20` | Database connection pool size |
| `GATEWAY_TIMEOUT` | `10s` | Timeout for gateway calls |

```yaml
gateway:
  timeout: 10s
  retries: 3
  circuitBreaker: true
```

## Release checklist

- [x] Update the changelog
- [x] Bump the chart version
- [ ] Notify #payments-oncall
- [ ] Run the smoke tests in staging

## Streaming settlement

Settlement now runs continuously on the event stream. See the [runbook](docs/runbook.md#settlement)
for replay and back-fill procedures.

## Support

Ask in #payments-help or page the on-call engineer for production incidents.

## Glossary

Authorisation means reserving funds on the card.

Capture means taking the reserved funds.

Settlement means moving money between banks.

Refund means returning captured money.

Chargeback means the cardholder disputed the payment.
