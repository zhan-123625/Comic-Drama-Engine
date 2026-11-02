/**
 * 阿里云百炼服务与 SDK 统一出口
 */

export * from "../providers/bailianManagedAgent.js";
export * from "../bailianPresets.js";

import Bailian20231229 from "@alicloud/bailian20231229";
import { $OpenApiUtil } from "@alicloud/openapi-core";

export { Bailian20231229, $OpenApiUtil };

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
  return new Bailian20231229(config);
}
