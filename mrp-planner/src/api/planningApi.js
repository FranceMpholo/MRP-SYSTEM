import { apiGet } from "./apiClient.js";

const MRP_API = "/api/mrp";

export const getPlanning = (options = {}) =>
  apiGet(`${MRP_API}/planning`, options);

export const getPlanningById = (id, options = {}) =>
  apiGet(`${MRP_API}/planning/${encodeURIComponent(id)}`, options);

export const getDepartments = (options = {}) =>
  apiGet(`${MRP_API}/departments`, options);

export const getShifts = (options = {}) =>
  apiGet(`${MRP_API}/shifts`, options);

export const getMachines = (options = {}) =>
  apiGet(`${MRP_API}/machines`, options);
