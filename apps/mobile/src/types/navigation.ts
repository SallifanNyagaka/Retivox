/**
 * React Navigation type definitions for the Retivox mobile app.
 *
 * Each role has its own tab navigator and secondary routes accessible through
 * the custom More bottom sheet.
 */

export type AuthStackParamList = {
  Login: undefined
}

export type OwnerTabParamList = {
  OwnerHome: undefined
  OwnerAnalytics: undefined
  OwnerTransactions: undefined
  OwnerMore: undefined
  OwnerBranches: undefined
  OwnerStock: undefined
  OwnerTransfers: undefined
  OwnerProducts: undefined
  OwnerFinances: undefined
  OwnerEmployees: undefined
  OwnerAdmins: undefined
  OwnerAudit: undefined
  OwnerSettings: undefined
  OwnerNotifications: undefined
}

export type AdminTabParamList = {
  AdminHome: undefined
  AdminStock: undefined
  AdminTransactions: undefined
  AdminMore: undefined
  AdminTransfers: undefined
  AdminProducts: undefined
  AdminDamagedStock: undefined
  AdminEmployees: undefined
  AdminSettings: undefined
  AdminNotifications: undefined
}

export type EmployeeTabParamList = {
  EmployeeHome: undefined
  EmployeePOS: undefined
  EmployeeTransactions: undefined
  EmployeeMore: undefined
  EmployeeStock: undefined
  EmployeeDamagedStock: undefined
  EmployeeProfile: undefined
  EmployeeNotifications: undefined
}
