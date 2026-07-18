import { env } from "@/lib/config/env";
import { localStorageDriver } from "./local";
import type { StorageDriver } from "./types";

function resolveDriver(): StorageDriver {
  switch (env.STORAGE_DRIVER) {
    case "local":
      return localStorageDriver;
    case "s3":
      throw new Error(
        "S3 storage driver is not implemented yet — set STORAGE_DRIVER=local",
      );
  }
}

export const storage = resolveDriver();
export type { StorageDriver } from "./types";
