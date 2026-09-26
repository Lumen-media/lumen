/**
 * Public surface of the module system.
 *
 * A module author only needs the `LumenHost` contract from `./types`; the rest
 * here is for host code driving the loader and the panel slots.
 */
export { globalBus } from './apis/bus';
export { getCommandRegistry } from './apis/commands';
export { ModuleErrorBoundary } from './components/ModuleErrorBoundary';
export { PanelSlot } from './components/PanelSlot';
export * from './injector';
export * from './store';
export * from './types';
