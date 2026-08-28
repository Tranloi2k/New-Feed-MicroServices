# Auth database migrations

Fresh databases can run `npm run migrate:deploy` directly.

Databases created previously with `prisma db push` already contain the baseline
`users` and `follows` tables. Before the first migration-based deployment, mark
only the baseline as applied, then deploy the remaining migrations:

```bash
npx prisma migrate resolve --applied 20260828160000_auth_baseline
npx prisma migrate deploy
```

The second migration intentionally stops if case-insensitive duplicate emails
exist. Resolve those duplicate accounts before retrying; it then normalizes email
addresses and converts the column to PostgreSQL `CITEXT`.
