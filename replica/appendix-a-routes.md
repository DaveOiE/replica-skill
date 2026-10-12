# Appendix A: route and endpoint inventory (observed)

Extracted from NexoPOS 6.2.4 route files (commit 4274cac, 2026-10-08). Paths are facts about the public HTTP surface, listed so our own API can be designed to cover the same capabilities. Our paths, names and payloads will be our own (see recon.md, section 13).

Web routes are screens under the `/dashboard` prefix, behind the session login. API routes are under `/api`, behind token auth. `perm=` is the permission the route demands (blank means login only).


## ai (MCP/AI)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/mcp/reports/{filename}` | closure@ |  |

## api/categories (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `categories/{id?}` | CategoryController@get |  |
| GET | `categories/{id?}/products` | CategoryController@getCategoriesProducts |  |
| GET | `categories/{id?}/variations` | CategoryController@getCategoriesVariations |  |
| GET | `categories/pos/{id?}` | CategoryController@getCategories |  |
| POST | `categories` | CategoryController@post | nexopos.create.categories |
| PUT | `categories/{id}` | CategoryController@put | nexopos.update.categories |
| DELETE | `categories/{id}` | CategoryController@delete | nexopos.delete.categories |
| POST | `categories/reorder` | CategoryController@reorderCategories | nexopos.update.categories |

## api/crud (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `crud/{namespace}` | CrudController@crudList |  |
| GET | `crud/{namespace}/columns` | CrudController@getColumns |  |
| GET | `crud/{namespace}/config` | CrudController@getConfig |  |
| GET | `crud/{namespace}/form-config/{id?}` | CrudController@getFormConfig |  |
| PUT | `crud/{namespace}/{id}` | CrudController@crudPut |  |
| GET | `crud/{namespace}/{id}` | CrudController@getResource |  |
| POST | `crud/{namespace}` | CrudController@crudPost |  |
| POST | `crud/{namespace}/export` | CrudController@exportCrud |  |
| POST | `crud/{namespace}/bulk-actions` | CrudController@crudBulkActions |  |
| DELETE | `crud/{namespace}/{id}` | CrudController@crudDelete |  |

## api/customers (API)

| verb | path | handler | permission |
|---|---|---|---|
| DELETE | `customers/{id}` | CustomersController@delete | nexopos.delete.customers |
| DELETE | `customers/using-email/{email}` | CustomersController@deleteUsingEmail | nexopos.delete.customers |
| GET | `customers/{customer?}` | CustomersController@get |  |
| GET | `customers/recently-active` | CustomersController@getRecentlyActive |  |
| GET | `customers/{customer}/orders` | CustomersController@getOrders |  |
| GET | `customers/{customer}/addresses` | CustomersController@getAddresses |  |
| GET | `customers/{customer}/group` | CustomersController@getGroup |  |
| GET | `customers/{customer}/coupons` | CustomersController@getCustomerCoupons |  |
| GET | `customers/{customer}/rewards` | CustomersController@getCustomerRewards |  |
| GET | `customers/{customer}/account-history` | CustomersController@getAccountHistory |  |
| POST | `customers` | CustomersController@post | nexopos.create.customers |
| POST | `customers/search` | CustomersController@searchCustomer | nexopos.read.customers |
| POST | `customers/coupons/{coupon}` | CustomersController@loadCoupons | nexopos.read.customers |
| POST | `customers/{customer}/crud/account-history` | CustomersController@recordAccountHistory | nexopos.customers.manage-account-history |
| PUT | `customers/{customer}` | CustomersController@put | nexopos.update.customers |
| POST | `customers/{customer}/account-history` | CustomersController@accountTransaction | nexopos.customers.manage-account-history |
| GET | `customers-groups/{id?}` | CustomersGroupsController@get | nexopos.read.customers-groups |
| GET | `customers-groups/{id?}/customers` | CustomersGroupsController@getCustomers |  |
| DELETE | `customers-groups/{id}` | CustomersGroupsController@delete | nexopos.delete.customers-groups |
| POST | `customers-groups` | CustomersGroupsController@post | nexopos.create.customers-groups |
| PUT | `customers-groups/{id}` | CustomersGroupsController@put | nexopos.update.customers-groups |
| POST | `customers-groups/transfer-customers` | CustomersGroupsController@transferOwnership |  |

## api/dashboard (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `dashboard/day` | DashboardController@getCards |  |
| GET | `dashboard/best-customers` | DashboardController@getBestCustomers |  |
| GET | `dashboard/best-cashiers` | DashboardController@getBestCashiers |  |
| GET | `dashboard/recent-orders` | DashboardController@getRecentsOrders |  |
| GET | `dashboard/weeks` | DashboardController@getWeekReports |  |

## api/fields (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/fields/{resource}/{identifier?}` | FieldsController@getFields |  |

## api/forms (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/forms/{resource}/{identifier?}` | FormsController@getForm |  |
| POST | `/forms/{resource}/{identifier?}` | FormsController@saveForm |  |

## api/marketplace (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `modules` | MarketplaceController@getModules |  |
| GET | `licenses/{item}` | MarketplaceController@getLicenses |  |
| POST | `add-to-cart` | MarketplaceController@addToCart |  |
| POST | `download` | MarketplaceController@downloadModule |  |
| GET | `categories` | MarketplaceController@getCategories |  |

## api/medias (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `medias` | MediasController@getMedias | nexopos.see.medias |
| DELETE | `medias/{id}` | MediasController@deleteMedia | nexopos.delete.medias |
| PUT | `medias/{media}` | MediasController@updateMedia | nexopos.update.medias |
| POST | `medias/bulk-delete/` | MediasController@bulkDeleteMedias | nexopos.delete.medias |
| POST | `medias` | MediasController@uploadMedias | nexopos.upload.medias |

## api/modules (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `modules/{argument?}` | ModulesController@getModules |  |
| PUT | `modules/{argument}/disable` | ModulesController@disableModule |  |
| PUT | `modules/{argument}/enable` | ModulesController@enableModule |  |
| DELETE | `modules/{argument}/delete` | ModulesController@deleteModule |  |
| POST | `modules/symlink` | ModulesController@createSymlink |  |
| POST | `modules/fix-permissions` | ModulesController@fixPublicModulesPermissions |  |
| POST | `modules` | ModulesController@uploadModule |  |

## api/notifications (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `notifications` | NotificationsController@getNotifications |  |
| DELETE | `notifications/{id}` | NotificationsController@deleteSingleNotification |  |
| DELETE | `notifications/all` | NotificationsController@deletAllNotifications |  |

## api/orders (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `orders/{id?}` | OrdersController@getOrders |  |
| GET | `orders/payments` | OrdersController@getSupportedPayments |  |
| GET | `orders/{id}/pos` | OrdersController@getPosOrder |  |
| GET | `orders/{id}/products` | OrdersController@getOrderProducts |  |
| GET | `orders/{order}/products/refunded` | OrdersController@getOrderProductsRefunded |  |
| GET | `orders/{order}/refunds` | OrdersController@getOrderRefunds |  |
| GET | `orders/{id}/payments` | OrdersController@getOrderPayments |  |
| GET | `orders/{order}/instalments` | OrdersController@getOrderInstalments | nexopos.read.orders-instalments |
| GET | `orders/{order}/print/{doc?}` | OrdersController@printOrder | nexopos.read.orders |
| POST | `orders/{order}/instalments/{instalment}/pay` | OrdersController@payInstalment | nexopos.update.orders-instalments |
| POST | `orders/{order}/void` | OrdersController@voidOrder | nexopos.void.orders |
| POST | `orders` | OrdersController@create | nexopos.create.orders |
| POST | `orders/{id}/products` | OrdersController@addProductToOrder | nexopos.update.orders |
| POST | `orders/{order}/processing` | OrdersController@changeOrderProcessingStatus | nexopos.update.orders |
| POST | `orders/{order}/delivery` | OrdersController@changeOrderDeliveryStatus | nexopos.update.orders |
| POST | `orders/{order}/payments` | OrdersController@addPayment | nexopos.make-payment.orders |
| POST | `orders/{order}/refund` | OrdersController@makeOrderRefund | nexopos.refund.orders |
| POST | `orders/{order}/instalments` | OrdersController@createInstalment | nexopos.create.orders-instalments |
| PUT | `orders/{order}/instalments/{instalment}` | OrdersController@updateInstalment | nexopos.update.orders-instalments |
| PUT | `orders/{id}` | OrdersController@updateOrder | nexopos.update.orders |
| DELETE | `orders/{order}/instalments/{instalment}` | OrdersController@deleteInstalment | nexopos.delete.orders-instalments |
| DELETE | `orders/{order}` | OrdersController@deleteOrder | nexopos.delete.orders |
| DELETE | `orders/{id}/products/{product_id}` | OrdersController@deleteOrderProduct | nexopos.update.orders |

## api/permissions (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `permissions/granted` | PermissionController@getAllGrandedPermissions |  |
| GET | `permissions/{namespace}` | PermissionController@getSinglePermission |  |
| GET | `permissions/{namespace}/check` | PermissionController@checkPermissionAccess |  |

## api/procurements (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `procurements/{id?}` | ProcurementController@list |  |
| GET | `procurements/{id}/products` | ProcurementController@procurementProducts |  |
| GET | `procurements/{id}/refresh` | ProcurementController@refreshProcurement |  |
| GET | `procurements/preload/{uuid}` | ProcurementController@preload |  |
| GET | `procurements/low-stock-suggestions` | ProcurementController@getLowStockSuggestions |  |
| GET | `procurements/{procurement}/set-as-paid` | ProcurementController@setAsPaid | nexopos.update.procurements |
| POST | `procurements/preload` | ProcurementController@storePreload |  |
| POST | `procurements/{id}/products` | ProcurementController@procure |  |
| POST | `procurements` | ProcurementController@create |  |
| POST | `procurements/products/search-procurement-product` | ProcurementController@searchProcurementProduct |  |
| POST | `procurements/products/search-product` | ProcurementController@searchProduct |  |
| PUT | `procurements/{procurement}` | ProcurementController@edit |  |
| PUT | `procurements/{procurement}/change-payment-status` | ProcurementController@changePaymentStatus |  |
| PUT | `procurements/{id}/products/{product_id}` | ProcurementController@editProduct |  |
| PUT | `procurements/{id}/products` | ProcurementController@bulkUpdateProducts |  |
| DELETE | `procurements/{id}/products/{product_id}` | ProcurementController@deleteProcurementProduct |  |
| DELETE | `procurements/{id}` | ProcurementController@deleteProcurement |  |

## api/products (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `products/pos/pinned` | ProductsController@getPinnedProducts |  |
| GET | `products` | ProductsController@getProduts |  |
| GET | `products/all/variations` | ProductsController@getAllVariations |  |
| GET | `products/{identifier}` | ProductsController@singleProduct |  |
| GET | `products/{identifier}/variations` | ProductsController@getProductVariations |  |
| GET | `products/{identifier}/refresh-prices` | ProductsController@refreshPrices |  |
| GET | `products/{identifier}/reset` | ProductsController@reset |  |
| GET | `products/{identifier}/history` | ProductsController@history |  |
| GET | `products/{identifier}/units` | ProductsController@units |  |
| GET | `products/{product}/units/{unit}/quantity` | ProductsController@getUnitQuantity |  |
| GET | `products/{product}/units/quantities` | ProductsController@getUnitQuantities |  |
| GET | `products/{product}/procurements` | ProductsController@getProcuredProducts |  |
| GET | `products/search/using-barcode/{product}` | ProductsController@searchUsingArgument |  |
| DELETE | `products/{identifier}` | ProductsController@deleteProduct |  |
| DELETE | `products/units/quantity/{unitQuantity}` | ProductsController@deleteUnitQuantity |  |
| DELETE | `products/all/variations` | ProductsController@deleteAllVariations |  |
| DELETE | `products/{identifier}/variations/{variation_id}` | ProductsController@deleteSingleVariation |  |
| DELETE | `products` | ProductsController@deleteAllProducts |  |
| POST | `products` | ProductsController@saveProduct | nexopos.create.products |
| POST | `products/search` | ProductsController@searchProduct | nexopos.read.products |
| POST | `products/adjustments` | ProductsController@createAdjustment | nexopos.update.products |
| POST | `products/adjustments/draft` | ProductsController@saveDraftAdjustment | nexopos.update.products |
| GET | `products/adjustments/{adjustment}` | ProductsController@getAdjustment | nexopos.update.products |
| PUT | `products/adjustments/{adjustment}` | ProductsController@updateDraftAdjustment | nexopos.update.products |
| GET | `products/adjustments/{adjustment}/execute` | ProductsController@executeAdjustment | nexopos.update.products |
| DELETE | `products/adjustments/{adjustment}` | ProductsController@deleteDraftAdjustment | nexopos.update.products |
| POST | `products/{identifier}/variations/{variation_id}` | ProductsController@createSingleVariation | nexopos.create.products |
| POST | `products/{product}/units/conversion` | ProductsController@convertUnits | nexopos.update.products |
| POST | `products/reorder` | ProductsController@reorderProducts | nexopos.update.products |
| PUT | `products/{identifier}/variations/{variation_id}` | ProductsController@editSingleVariation | nexopos.update.products |
| PUT | `products/{product}` | ProductsController@updateProduct | nexopos.update.products |

## api/providers (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `providers` | ProvidersController@list | nexopos.read.providers |
| GET | `providers/{id}/procurements` | ProvidersController@providerProcurements | nexopos.read.providers |
| DELETE | `providers/{id}` | ProvidersController@deleteProvider | nexopos.delete.providers |

## api/registers (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `cash-registers/{id?}` | CashRegistersController@getRegisters |  |
| GET | `cash-registers/used` | CashRegistersController@getUsedRegister |  |
| GET | `cash-registers/session-history/{register}` | CashRegistersController@getSessionHistory |  |
| POST | `cash-registers/{action}/{register}` | CashRegistersController@performAction | nexopos.use.registers |
| GET | `registers/{id}/history` | CashRegistersController@getHistory |  |
| GET | `registers/{id}/orders` | CashRegistersController@getRegisterOrders |  |
| PUT | `registers/{id}` | CashRegistersController@editRegister |  |
| POST | `registers` | CashRegistersController@create |  |
| DELETE | `registers/{id}` | CashRegistersController@deleteRegister |  |
| DELETE | `registers/{id}/history/{history_id}` | CashRegistersController@deleteRegisterHistory |  |

## api/reports (API)

| verb | path | handler | permission |
|---|---|---|---|
| POST | `reports/sale-report` | ReportsController@getSaleReport | nexopos.reports.sales |
| POST | `reports/sold-stock-report` | ReportsController@getSoldStockReport | nexopos.reports.sales |
| POST | `reports/profit-report` | ReportsController@getProfit | nexopos.reports.sales |
| POST | `reports/transactions` | ReportsController@getAccountSummaryReport | nexopos.reports.transactions |
| POST | `reports/annual-report` | ReportsController@getAnnualReport | nexopos.reports.yearly |
| POST | `reports/payment-types` | ReportsController@getPaymentTypes | nexopos.reports.payment-types |
| POST | `reports/products-report` | ReportsController@getProductsReport | nexopos.reports.products-report |
| POST | `reports/compute/{type}` | ReportsController@computeReport | nexopos.reports.sales |
| GET | `reports/cashier-report` | ReportsController@getMyReport |  |
| POST | `reports/low-stock` | ReportsController@getLowStock | nexopos.reports.low-stock |
| POST | `reports/stock-report` | ReportsController@getStockReport | nexopos.reports.inventory |
| POST | `reports/product-history-combined` | ReportsController@getProductHistoryCombined | nexopos.reports.stock-history |
| POST | `reports/customers-statement/{customer}` | ReportsController@getCustomerStatement | nexopos.reports.customers-statement |
| POST | `reports/compute-combined-report` | ReportsController@computeCombinedReport | nexopos.reports.sales |

## api/reset (API)

| verb | path | handler | permission |
|---|---|---|---|
| POST | `reset` | ResetController@truncateWithDemo | manage.options |

## api/rewards (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `reward-system/{id}/rules` | RewardsSystemController@getRules |  |
| GET | `reward-system/{id}/coupons` | RewardsSystemController@getRegisterOrders |  |
| POST | `reward-system` | RewardsSystemController@create | nexopos.create.rewards |
| DELETE | `reward-system/{id}` | RewardsSystemController@deleteRewardSystem | nexopos.delete.rewards |
| PUT | `reward-system/{id}` | RewardsSystemController@editRewardSystem | nexopos.update.rewards |

## api/scan-utility (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `barcode-reader/state` | ScanUtilityController@getBarcodeReaderState |  |

## api/settings (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/settings/{identifier}` | SettingsController@getSettingsForm | manage.options |
| POST | `/settings/{identifier}` | SettingsController@saveSettingsForm | manage.options |

## api/system (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `system/fix-symbolic-links` | DashboardController@createSymbolicLinks | update.core |
| POST | `system/telemetry` | DashboardController@dispatchTelemetry |  |

## api/taxes (API)

| verb | path | handler | permission |
|---|---|---|---|
| POST | `taxes` | TaxesController@post | nexopos.create.taxes |
| PUT | `taxes/{id}` | TaxesController@put | nexopos.update.taxes |
| DELETE | `taxes/{id}` | TaxesController@delete | nexopos.delete.taxes |
| GET | `taxes/{id?}` | TaxesController@get |  |
| GET | `taxes/groups/{id?}` | TaxesController@getTaxGroup |  |

## api/transactions (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `transactions/{id?}` | TransactionController@get |  |
| GET | `transactions/configurations/{transaction?}` | TransactionController@getConfigurations |  |
| GET | `transactions/rules` | TransactionController@getRules |  |
| GET | `transactions/trigger/{transaction?}` | TransactionController@triggerTransaction | nexopos.update.transactions |
| GET | `transactions/history/{history}/create-reflection` | TransactionController@createReflection | nexopos.create.transactions-history |
| POST | `transactions` | TransactionController@post | nexopos.create.transactions |
| POST | `transactions/rules` | TransactionController@saveRule | nexopos.update.transactions |
| DELETE | `transactions/rules/{rule}` | TransactionController@deleteRule | nexopos.update.transactions |
| PUT | `transactions/{id}` | TransactionController@put | nexopos.update.transactions |
| DELETE | `transactions/{transaction}` | TransactionController@delete | nexopos.delete.transactions |
| GET | `transactions-accounts/{id?}` | TransactionController@getExpensesCategories |  |
| GET | `transactions-accounts/sub-accounts` | TransactionController@getSubAccounts |  |
| GET | `transactions-accounts/actions` | TransactionController@getActions |  |
| GET | `transactions-accounts/{id}/history` | TransactionController@getTransactionAccountsHistory |  |
| POST | `transactions-accounts/category-identifier` | TransactionController@getTransactionAccountFromCategory |  |
| GET | `transactions-accounts/reset-defaults` | TransactionController@resetDefaultAccounts | nexopos.update.transactions-account |
| POST | `transactions-accounts` | TransactionController@postTransactionsAccount | nexopos.create.transactions-account |
| PUT | `transactions-accounts/{account}` | TransactionController@putTransactionAccount | nexopos.update.transactions-account |
| DELETE | `transactions-accounts/{account}` | TransactionController@deleteAccount | nexopos.delete.transactions-account |

## api/units (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `units/{id?}` | UnitsController@get |  |
| GET | `units/{id}/group` | UnitsController@getUnitParentGroup |  |
| GET | `units/{id}/siblings` | UnitsController@getSiblingUnits |  |
| GET | `units-groups/{id?}` | UnitsController@getGroups |  |
| GET | `units-groups/{id}/units` | UnitsController@getGroupUnits |  |
| POST | `units` | UnitsController@postUnit | nexopos.create.products-units |
| POST | `units-groups` | UnitsController@postGroup | nexopos.create.products-units |
| DELETE | `units/{id}` | UnitsController@deleteUnit | nexopos.delete.products-units |
| DELETE | `units-groups/{id}` | UnitsController@deleteUnitGroup | nexopos.delete.products-units |
| PUT | `units-groups/{id}` | UnitsController@putGroup | nexopos.update.products-units |
| PUT | `units/{id}` | UnitsController@putUnit | nexopos.update.products-units |

## api/update (API)

| verb | path | handler | permission |
|---|---|---|---|
| POST | `update` | UpdateController@runMigration |  |

## api/users (API)

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/user` | UsersController@getUser |  |
| GET | `/user/permissions` | UsersController@getUserPermissions | read.users |
| POST | `/user/access/{id}` | UsersController@approveAccess |  |
| GET | `/user/access/{id}` | UsersController@getAccess |  |
| GET | `/user/access/{access}/use` | UsersController@markAccessAsUsed |  |
| PUT | `/users/widgets` | UsersController@configureWidgets |  |
| POST | `/users/create-token` | UsersController@createToken |  |
| GET | `/users/tokens` | UsersController@getTokens |  |
| DELETE | `/users/tokens/{id}` | UsersController@deleteToken |  |
| POST | `/users/check-permission` | UsersController@checkPermission |  |
| GET | `/users` | UsersController@getUsers | read.users |
| GET | `/users/permissions` | UsersController@getPermissions | read.users |
| GET | `/users/roles` | UsersController@getRoles | read.roles |
| PUT | `/users/roles` | UsersController@updateRole | update.roles |
| GET | `/users/roles/{role}/clone` | UsersController@cloneRole | create.roles |
| POST | `/user/snooze-ads` | UsersController@snoozeAds |  |
| POST | `/user/guides` | UsersController@getGuides |  |
| POST | `/user/guides/dismiss` | UsersController@dismissGuide |  |
| POST | `/user/guides/complete` | UsersController@completeGuide |  |
| GET | `/user/guides/completed` | UsersController@getCompletedGuides |  |
| GET | `/user/guides/dismissed` | UsersController@getDismissedGuides |  |
| POST | `/user/guides/reset` | UsersController@resetGuide |  |

## web/cash-registers (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/cash-registers` | CashRegistersController@listRegisters |  |
| GET | `/cash-registers/create` | CashRegistersController@createRegister |  |
| GET | `/cash-registers/edit/{register}` | CashRegistersController@editRegister |  |
| GET | `/cash-registers/history/{register}` | CashRegistersController@getRegisterHistory |  |
| GET | `/cash-registers/z-report/{register}` | CashRegistersController@getRegisterZReport |  |

## web/customers (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/customers` | CustomersController@listCustomers |  |
| GET | `/customers/create` | CustomersController@createCustomer |  |
| GET | `/customers/edit/{customer}` | CustomersController@editCustomer |  |
| GET | `/customers/{customer}/rewards` | CustomersController@getCustomersRewards |  |
| GET | `/customers/{customer}/rewards/edit/{reward}` | CustomersController@editCustomerReward |  |
| GET | `/customers/{customer}/orders` | CustomersController@getCustomersOrders |  |
| GET | `/customers/{customer}/coupons` | CustomersController@getCustomersCoupons |  |
| GET | `/customers/{customer}/coupons/{customerCoupon}/history` | CustomersController@listCustomerCouponHistory |  |
| GET | `/customers/{customer}/account-history` | CustomersController@getCustomerAccountHistory |  |
| GET | `/customers/{customer}/account-history/create` | CustomersController@createCustomerAccountHistory |  |
| GET | `/customers/{customer}/account-history/edit/{customerAccountHistory}` | CustomersController@editCustomerAccountHistory |  |
| GET | `/customers/groups` | CustomersGroupsController@listCustomersGroups |  |
| GET | `/customers/groups/create` | CustomersGroupsController@createCustomerGroup |  |
| GET | `/customers/groups/edit/{group}` | CustomersGroupsController@editCustomerGroup |  |
| GET | `/customers/rewards-system` | RewardsSystemController@list |  |
| GET | `/customers/rewards-system/create` | RewardsSystemController@create |  |
| GET | `/customers/rewards-system/edit/{reward}` | RewardsSystemController@edit |  |
| GET | `/customers/coupons` | CustomersController@listCoupons |  |
| GET | `/customers/coupons/create` | CustomersController@createCoupon |  |
| GET | `/customers/coupons/edit/{coupon}` | CustomersController@editCoupon |  |
| GET | `/customers/coupons/history/{coupon}` | CustomersController@couponHistory |  |
| GET | `/customers/coupons-generated` | CustomersController@listGeneratedCoupons |  |
| GET | `/customers/coupons-generated/edit/{coupon}` | CustomersController@editGeneratedCoupon |  |

## web/medias (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/medias` | MediasController@showMedia |  |

## web/modules (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/modules` | ModulesController@listModules |  |
| GET | `/modules/upload` | ModulesController@showUploadModule |  |
| GET | `/modules/download/{identifier}` | ModulesController@downloadModule |  |
| GET | `/modules/migrate/{namespace}` | ModulesController@migrateModule |  |
| GET | `/modules/marketplace` | ModulesController@showMarketplace |  |

## web/oauth (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `authorize` | MarketplaceController@oauthAuthorize |  |
| GET | `callback` | MarketplaceController@oauthCallback |  |

## web/orders (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/orders` | OrdersController@listOrders |  |
| GET | `/orders/instalments` | OrdersController@listInstalments |  |
| GET | `/orders/payments-types` | OrdersController@listPaymentsTypes |  |
| GET | `/orders/payments-types/create` | OrdersController@createPaymentType |  |
| GET | `/orders/payments-types/edit/{paymentType}` | OrdersController@updatePaymentType |  |
| GET | `/orders/invoice/{order}` | OrdersController@orderInvoice |  |
| GET | `/orders/receipt/{order}` | OrdersController@orderReceipt |  |
| GET | `/orders/refund-receipt/{refund}` | OrdersController@orderRefundReceipt |  |
| GET | `/orders/payment-receipt/{orderPayment}` | OrdersController@getOrderPaymentReceipt |  |
| GET | `/pos` | OrdersController@showPOS |  |

## web/procurements (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/procurements` | ProcurementController@listProcurements |  |
| GET | `/procurements/create` | ProcurementController@createProcurement |  |
| GET | `/procurements/products` | ProcurementController@getProcurementProducts |  |
| GET | `/procurements/products/edit/{product}` | ProcurementController@editProcurementProduct |  |
| GET | `/procurements/edit/{procurement}` | ProcurementController@updateProcurement |  |
| GET | `/procurements/edit/{procurement}/invoice` | ProcurementController@procurementInvoice |  |

## web/products (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/products` | ProductsController@listProducts |  |
| GET | `/products/create` | ProductsController@createProduct |  |
| GET | `/products/stock-adjustment` | ProductsController@showStockAdjustment |  |
| GET | `/products/stock-adjustment/{history}` | ProductsController@showStockAdjustmentEdit |  |
| GET | `/products/adjustment-history` | ProductsController@listAdjustmentHistory |  |
| GET | `/products/print-labels` | ProductsController@printLabels |  |
| GET | `/products/edit/{product}` | ProductsController@editProduct |  |
| GET | `/products/{product}/units` | ProductsController@productUnits |  |
| GET | `/products/{product}/history` | ProductsController@productHistory |  |
| GET | `/products/categories` | CategoryController@listCategories |  |
| GET | `/products/categories/create` | CategoryController@createCategory |  |
| GET | `/products/categories/edit/{category}` | CategoryController@editCategory |  |
| GET | `/products/categories/compute-products/{category}` | CategoryController@computeCategoryProducts |  |
| GET | `/products/stock-flow-records` | CategoryController@showStockFlowCrud |  |
| GET | `/products/scale-range` | ProductsController@getScaleRange |  |
| GET | `/products/scale-range/create` | ProductsController@createScaleRange |  |
| GET | `/products/scale-range/edit/{scaleRange}` | ProductsController@editScaleRange |  |

## web/providers (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/providers` | ProvidersController@listProviders |  |
| GET | `/providers/create` | ProvidersController@createProvider |  |
| GET | `/providers/edit/{provider}` | ProvidersController@editProvider |  |
| GET | `/providers/{provider}/procurements` | ProvidersController@listProvidersProcurements |  |
| GET | `/providers/{provider}/products` | ProvidersController@listProvidersProducts |  |

## web/reports (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/reports/sales` | ReportsController@salesReport |  |
| GET | `/reports/sales-progress` | ReportsController@salesProgress |  |
| GET | `/reports/low-stock` | ReportsController@stockReport |  |
| GET | `/reports/sold-stock` | ReportsController@soldStock |  |
| GET | `/reports/stock-history` | ReportsController@stockCombinedReport |  |
| GET | `/reports/profit` | ReportsController@profit |  |
| GET | `/reports/transactions` | ReportsController@transactionsReport |  |
| GET | `/reports/annual-report` | ReportsController@annualReport |  |
| GET | `/reports/payment-types` | ReportsController@salesByPaymentTypes |  |
| GET | `/reports/customers-statement` | ReportsController@showCustomerStatement |  |

## web/settings (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/settings/{settings}` | SettingsController@getSettings | manage.options |

## web/taxes (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/taxes` | TaxesController@listTaxes |  |
| GET | `/taxes/create` | TaxesController@createTax |  |
| GET | `/taxes/edit/{tax}` | TaxesController@editTax |  |
| GET | `/taxes/groups` | TaxesController@taxesGroups |  |
| GET | `/taxes/groups/create` | TaxesController@createTaxGroups |  |
| GET | `/taxes/groups/edit/{group}` | TaxesController@editTaxGroup |  |

## web/transactions (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/accounting/transactions` | TransactionController@listTransactions |  |
| GET | `/accounting/transactions/create` | TransactionController@createTransaction |  |
| GET | `/accounting/transactions/edit/{transaction}` | TransactionController@editTransaction |  |
| GET | `/accounting/transactions/history/{transaction}` | TransactionController@getTransactionHistory |  |
| GET | `/accounting/transactions/history` | TransactionController@transactionsHistory |  |
| GET | `/accounting/accounts` | TransactionsAccountController@listTransactionsAccounts |  |
| GET | `/accounting/accounts/create` | TransactionsAccountController@createTransactionsAccounts |  |
| GET | `/accounting/accounts/edit/{account}` | TransactionsAccountController@editTransactionsAccounts |  |
| GET | `/accounting/rules` | TransactionsAccountController@listTransactionsRules |  |

## web/units (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/units` | UnitsController@listUnits |  |
| GET | `/units/edit/{unit}` | UnitsController@editUnit |  |
| GET | `/units/create` | UnitsController@createUnit |  |
| GET | `/units/groups` | UnitsController@listUnitsGroups |  |
| GET | `/units/groups/create` | UnitsController@createUnitGroup |  |
| GET | `/units/groups/edit/{group}` | UnitsController@editUnitGroup |  |

## web/users (Screen (web))

| verb | path | handler | permission |
|---|---|---|---|
| GET | `/users` | UsersController@listUsers |  |
| GET | `/users/create` | UsersController@createUser |  |
| GET | `/users/edit/{user}` | UsersController@editUser |  |
| GET | `/users/roles/permissions-manager` | UsersController@permissionManager |  |
| GET | `/users/profile` | UsersController@getProfile |  |
| GET | `/users/roles` | UsersController@rolesList |  |
| GET | `/users/roles/create` | UsersController@createRole |  |
| GET | `/users/roles/edit/{role}` | UsersController@editRole |  |
