import { createDatabase } from "./database";
import { migrate } from "./migrate";

const database = await createDatabase();

try {
  await migrate(database);
  console.log("Cruio 数据库迁移已完成。");
} finally {
  await database.close();
}
