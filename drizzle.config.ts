// Sites template, copyright (c) 2026 OpenAI, MIT.
// See LICENSES/OpenAI-create-sites-MIT.txt.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "sqlite",
});
