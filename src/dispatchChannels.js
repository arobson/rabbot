import dispatcher from 'topic-dispatch';

// Replaces postal's channel registry. topic-dispatch dispatchers are
// meant to be per-instance/isolated (unlike postal's shared, named
// channels), so these three module-scoped singletons play the same
// "named global channel" role postal's channel registry did.
export const dispatchChannel = dispatcher(); // was postal.channel('rabbit.dispatch')
export const responseChannel = dispatcher(); // was postal.channel('rabbit.responses')
export const ackChannel = dispatcher(); // was postal.channel('rabbit.ack')
