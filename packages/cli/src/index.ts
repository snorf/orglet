#!/usr/bin/env node
// @orglet/cli: orglet up / check / reset
import { main } from "./main.js";

main(process.argv.slice(2))
  .then((code) => {
    if (code >= 0) process.exit(code);
  })
  .catch((err: unknown) => {
    console.error((err as Error).stack ?? String(err));
    process.exit(1);
  });
