import { describe, expect, it } from "vitest";
import { keysCsv, keysEnv } from "./key-export";

describe("key export", () => {
  const keys = [{ domain: "vino.com.py", name: 'Vino, "tinto"', apiKey: "vc_live_x" }];

  it("quotes CSV cells that need it and starts with a BOM", () => {
    expect(keysCsv(keys, "https://crm.example")).toBe(
      '﻿domain,name,vendercrm_url,vendercrm_api_key\nvino.com.py,"Vino, ""tinto""",https://crm.example,vc_live_x\n',
    );
  });

  it("writes the two env lines per site under a comment", () => {
    expect(keysEnv(keys, "https://crm.example")).toBe(
      '# vino.com.py — Vino, "tinto"\nVENDERCRM_URL=https://crm.example\nVENDERCRM_API_KEY=vc_live_x\n',
    );
  });
});
