import schema from '../../../data-schema.json';
import pkg from '../../../package.json';

/** Workspace schema understood by this renderer. Bump together with data-schema.json. */
export const DATA_SCHEMA_VERSION = Number(schema.version) || 1;
export const SOLVER_PROTOCOL_VERSION = String(schema.solverProtocol || '1.0');
export const APP_VERSION = String(pkg.version || '0.0.0');
/** Minimum server schema required for homeroom/roomMode semantics. */
export const MIN_SERVER_SCHEMA = DATA_SCHEMA_VERSION;
