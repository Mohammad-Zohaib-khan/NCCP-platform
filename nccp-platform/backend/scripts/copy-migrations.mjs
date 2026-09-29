// tsc does not copy .sql files; ship them next to the compiled migrate.js
import { cpSync, mkdirSync } from 'node:fs'
mkdirSync('dist/db/migrations', { recursive: true })
cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true })
console.log('copied migrations to dist/db/migrations')
