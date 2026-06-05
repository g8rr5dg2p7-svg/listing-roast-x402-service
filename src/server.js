import "dotenv/config";

import { createApp } from "./app.js";

const port = Number(process.env.PORT || 8787);
const app = createApp();

app.listen(port, () => {
  console.log(`Listing Roast x402 listening on http://localhost:${port}`);
});
