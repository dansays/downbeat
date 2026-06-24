// node-roon-api and its service modules ship no TypeScript types. We use them only through the
// thin wrapper in roon.ts, so an `any` shim keeps the rest of the codebase strict without
// scattering casts. See https://github.com/RoonLabs/node-roon-api.
declare module "node-roon-api";
declare module "node-roon-api-browse";
declare module "node-roon-api-status";
declare module "node-roon-api-transport";
