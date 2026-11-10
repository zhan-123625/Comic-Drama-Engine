/**
 * 阿里云百炼服务与 SDK 统一出口
 */

export * from "../providers/bailianManagedAgent.js";
export * from "../bailianPresets.js";

import BailianPkg from "@alicloud/bailian20231229";
import { createRequire } from "node:module";
// Resolve the SDK dependency from the SDK itself; npm may nest it rather than hoist it.
const sdkRequire = createRequire(createRequire(import.meta.url).resolve("@alicloud/bailian20231229"));
const { $OpenApiUtil } = sdkRequire("@alicloud/openapi-core");

export type Bailian20231229 = any;

const ClientClass = ((BailianPkg as any).default || BailianPkg) as new (config: any) => Bailian20231229;

export { ClientClass as BailianClient, $OpenApiUtil };

/**
 * 快速创建官方 OpenAPI Client
 */
export function createBailianOpenApiClient(opts: {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint?: string;
  regionId?: string;
}): Bailian20231229 {
  const config = new $OpenApiUtil.Config({
    accessKeyId: opts.accessKeyId,
    accessKeySecret: opts.accessKeySecret,
    endpoint: opts.endpoint || "bailian.cn-beijing.aliyuncs.com",
    regionId: opts.regionId || "cn-beijing",
  });
  return new ClientClass(config);
}
