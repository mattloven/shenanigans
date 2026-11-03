# Payments Service

The payments service handles card authorisation and settlement for all storefronts.
It is owned by the **Checkout** team and runs in three regions.

![Architecture](docs/architecture.png)

## Getting started

1. Clone the repository.
2. Run `make bootstrap` to install dependencies.
3. Start the stack with `docker compose up`.

> **Note:** You need access to the staging vault before running locally.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP port |
| `DB_POOL` | `10` | Database connection pool size |
| `RETRY_LIMIT` | `3` | Retries for gateway calls |

```yaml
gateway:
  timeout: 30s
  retries: 3
```

## Release checklist

- [x] Update the changelog
- [ ] Bump the chart version
- [ ] Notify #payments-oncall

## Legacy settlement

The nightly settlement batch is scheduled with cron on the old VM fleet. It will be removed once
the streaming pipeline is live in every region.

## Support

Ask in #payments-help or page the on-call engineer for production incidents.

## Glossary

Authorisation means reserving funds on the card.

Capture means taking the reserved funds.

Settlement means moving money between banks.

Refund means returning captured money.

Chargeback means the cardholder disputed the payment.
