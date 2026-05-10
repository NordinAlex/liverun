import util from 'util';

// Override util._extend to prevent DEP0060 warning from http-proxy
// This must be evaluated before http-proxy is imported.
// We avoid checking if util._extend exists to prevent triggering the deprecation getter.
util._extend = Object.assign;
