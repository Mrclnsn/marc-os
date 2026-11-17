import { connect, type Db } from "./connect";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { db?: Db };

// Eén verbinding per proces (ook bij hot reload in development)
export const db: Db = globalForDb.db ?? (globalForDb.db = connect().db);
export { schema };
