// === Existing surface (preserved unchanged for v0.1.x backwards compatibility) ===

export { verifyBrokerToken, BrokerTokenError } from './broker-token.js'
export type { BrokerTokenPayload, VerifyBrokerTokenOptions } from './broker-token.js'
export type { BrokerTokenErrorCode } from './errors.js'
export { verifyWebhookSignature, signWebhookPayload } from './webhook.js'
export { resolveAlias, introspectSession, getAuditLog } from './client.js'
export type {
  ComsClient,
  AliasResult,
  ResolveAliasResponse,
  SessionUser,
  IntrospectSessionResponse,
  AuditLogEntry,
  GetAuditLogParams,
  GetAuditLogResponse,
} from './client.js'

// === v1.0 — typed webhook envelope + role envelope reader (PR B) ===

export { defineWebhookHandler, WebhookEnvelopeError } from './webhook-typed.js'
export type {
  WebhookHandlerMap,
  WebhookHandlerContext,
  DefineWebhookHandlerOptions,
} from './webhook-typed.js'
export type { EventPayloadMap, PayloadFor } from './event-payload-map.js'
export { getAppRole } from './role-envelope.js'
export type { AppRole, GetAppRoleOptions } from './role-envelope.js'

// === v1.0 — contract-version surface (PR C) ===

export {
  PORTAL_AUTH_CONTRACT_VERSION,
  PORTAL_WEBHOOK_CONTRACT_VERSION,
  assertContractVersionCompatible,
  ContractVersionMismatchError,
} from './contract-version.js'
export type {
  ContractVersionKind,
  ContractVersionMismatchCode,
} from './contract-version.js'

// === v1.0 — manifest helpers (PR D) ===

export { defineManifest, registerManifest } from './manifest.js'
export type {
  ManifestDefinition,
  ConfigField,
  FieldType,
  EnumField,
  BooleanField,
  IntegerField,
  StringField,
  RegisterManifestOptions,
  RegisterManifestResponse,
} from './manifest.js'

// === v1.0 — re-exports from @coms-portal/shared (Q2: single import source) ===

export type {
  PortalWebhookEnvelope,
  PortalWebhookEvent,
  SessionRevokedPayload,
  UserProvisionedPayload,
  UserUpdatedPayload,
  UserOffboardedPayload,
  AliasResolvedPayload,
  AliasUpdatedPayload,
  AliasDeletedPayload,
  AppConfigUpdatedPayload,
  AppConfigEvent,
  EmploymentUpdatedPayload,
  TaxonomyUpsertedPayload,
  TaxonomyDeletedPayload,
  TaxonomyEvent,
  WebhookUserEnvelope,
  TaxonomyRef,
  EmploymentBlock,
  ContactEmail,
  UserEmailEntry,
  UserEmailKind,
  UserEmailAddedBy,
} from '@coms-portal/shared/contracts/webhook-events'
export {
  PORTAL_WEBHOOK_EVENTS,
  USER_EMAIL_KINDS,
  USER_EMAIL_ADDED_BY,
  PORTAL_WEBHOOK_SIGNATURE_HEADER,
  PORTAL_WEBHOOK_EVENT_HEADER,
  PORTAL_WEBHOOK_EVENT_ID_HEADER,
  PORTAL_WEBHOOK_TIMESTAMP_HEADER,
} from '@coms-portal/shared/contracts/webhook-events'

export type {
  PortalSessionUser,
  PortalRole,
  PortalClaims,
  AuthTransportMode,
  PortalBrokerExchangePayload,
  PortalBrokerHandoffResponse,
} from '@coms-portal/shared/contracts/auth'
export {
  PORTAL_ROLES,
  PORTAL_ROLE_LABELS,
  AUTH_TRANSPORT_MODES,
  DEFAULT_AUTH_TRANSPORT_MODE,
  isPortalRole,
  hasPortalRole,
} from '@coms-portal/shared/contracts/auth'

export type {
  PortalIntegrationManifest,
  PortalAppRole,
  PortalAdapterType,
  PortalAdapterContract,
  PortalAuthEntrypoint,
  AuthEntrypointKind,
  PortalRoutePattern,
  PortalRuntimeDescriptor,
  PortalEnvRequirement,
  PortalComplianceMetadata,
  PortalComplianceStatus,
  PortalHandoffMode,
  PortalLifecycleWebhookContract,
  ProtectedRouteMode,
  HttpMethod,
} from '@coms-portal/shared/contracts/integration-manifest'
export {
  PORTAL_INTEGRATION_MANIFEST_VERSION,
  PORTAL_INTEGRATION_MANIFEST_FILE,
  PORTAL_ADAPTER_TYPES,
  PROTECTED_ROUTE_MODES,
  PORTAL_COMPLIANCE_STATUSES,
  PORTAL_HANDOFF_MODES,
  HTTP_METHODS,
  AUTH_ENTRYPOINT_KINDS,
  isPortalAdapterType,
  isProtectedRouteMode,
  isPortalComplianceStatus,
  isPortalHandoffMode,
  createPortalIntegrationManifest,
  validatePortalIntegrationManifest,
} from '@coms-portal/shared/contracts/integration-manifest'

// === v1.1 — APP_LAUNCHER re-export (Rev 4 Spec 02 §SA) ===
// Single-source-of-truth import path for H-apps still rendering the cross-app
// launcher. Carries shared's @deprecated marker through re-export.

export { APP_LAUNCHER } from '@coms-portal/shared/constants/app-launcher'
