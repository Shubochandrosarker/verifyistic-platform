<?php
/**
 * Plugin Name: Verifyistic Connector
 * Description: Connects WordPress to a Verifyistic Cloud or Self-Hosted endpoint (doc 10): site-scoped server-side credential, signed webhook receiver, user waiver requests, status shortcode. The separate Verifyistic Core plugin keeps owning the local age gate — this connector never treats an age-gate cookie as a waiver (doc 24).
 * Version: 1.0.0
 * Author: WordPressistic
 * License: GPL-2.0-or-later
 * Text Domain: verifyistic-connector
 */

if (!defined('ABSPATH')) {
	exit;
}

define('VERIFYISTIC_CONNECTOR_VERSION', '1.0.0');
define('VERIFYISTIC_CONNECTOR_OPTION', 'verifyistic_connector');

/* --------------------------------------------------------------------------
 * Settings
 * ------------------------------------------------------------------------ */

/**
 * @return array{mode:string,base_url:string,api_key:string,webhook_secret:string,site_id:string}
 */
function verifyistic_connector_settings(): array
{
	$settings = get_option(VERIFYISTIC_CONNECTOR_OPTION, array());
	if (!is_array($settings)) {
		$settings = array();
	}
	return array(
		'mode'           => isset($settings['mode']) && 'self_hosted' === $settings['mode'] ? 'self_hosted' : 'cloud',
		'base_url'       => isset($settings['base_url']) ? untrailingslashit(esc_url_raw($settings['base_url'])) : 'https://api.verifyistic.com/v1',
		'api_key'        => isset($settings['api_key']) ? (string) $settings['api_key'] : '',
		'webhook_secret' => isset($settings['webhook_secret']) ? (string) $settings['webhook_secret'] : '',
		'site_id'        => isset($settings['site_id']) ? sanitize_text_field($settings['site_id']) : '',
	);
}

function verifyistic_connector_api_request(string $method, string $path, $body = null, ?string $idempotency_key = null)
{
	$settings = verifyistic_connector_settings();
	if ('' === $settings['api_key']) {
		return new WP_Error('verifyistic_not_configured', __('Verifyistic connector has no API key configured.', 'verifyistic-connector'));
	}
	$args = array(
		'method'  => $method,
		'timeout' => 20,
		'headers' => array(
			'Authorization' => 'Bearer ' . $settings['api_key'],
			'Content-Type'  => 'application/json',
			'Accept'        => 'application/json',
		),
	);
	if (null !== $body) {
		$args['body'] = wp_json_encode($body);
	}
	if (null !== $idempotency_key) {
		$args['headers']['Idempotency-Key'] = $idempotency_key;
	}
	$response = wp_remote_request($settings['base_url'] . $path, $args);
	if (is_wp_error($response)) {
		return $response;
	}
	$code = (int) wp_remote_retrieve_response_code($response);
	$payload = json_decode(wp_remote_retrieve_body($response), true);
	if ($code < 200 || $code >= 300) {
		$message = is_array($payload) && isset($payload['error']['message'])
			? (string) $payload['error']['message']
			: sprintf(/* translators: %d: HTTP status */ __('Verifyistic API error (HTTP %d).', 'verifyistic-connector'), $code);
		return new WP_Error('verifyistic_api_error', $message, array('status' => $code));
	}
	return is_array($payload) && array_key_exists('data', $payload) ? $payload['data'] : $payload;
}

/* --------------------------------------------------------------------------
 * Admin settings page (capability-managed; key never printed back in full)
 * ------------------------------------------------------------------------ */

add_action('admin_menu', function () {
	add_options_page(
		__('Verifyistic Connector', 'verifyistic-connector'),
		__('Verifyistic Connector', 'verifyistic-connector'),
		'manage_options',
		'verifyistic-connector',
		'verifyistic_connector_render_settings'
	);
});

add_action('admin_init', function () {
	register_setting('verifyistic_connector', VERIFYISTIC_CONNECTOR_OPTION, array(
		'type'              => 'array',
		'sanitize_callback' => 'verifyistic_connector_sanitize_settings',
	));
});

/**
 * @param mixed $input
 * @return array
 */
function verifyistic_connector_sanitize_settings($input): array
{
	$settings = verifyistic_connector_settings();
	if (!is_array($input)) {
		return $settings;
	}
	// An empty api_key / secret field keeps the stored value (never prints it back).
	if (isset($input['api_key']) && '' !== trim((string) $input['api_key'])) {
		$settings['api_key'] = sanitize_text_field((string) $input['api_key']);
	}
	if (isset($input['webhook_secret']) && '' !== trim((string) $input['webhook_secret'])) {
		$settings['webhook_secret'] = sanitize_text_field((string) $input['webhook_secret']);
	}
	if (isset($input['mode'])) {
		$settings['mode'] = 'self_hosted' === $input['mode'] ? 'self_hosted' : 'cloud';
	}
	if (isset($input['base_url'])) {
		$settings['base_url'] = untrailingslashit(esc_url_raw((string) $input['base_url']));
	}
	if (isset($input['site_id'])) {
		$settings['site_id'] = sanitize_text_field((string) $input['site_id']);
	}
	return $settings;
}

function verifyistic_connector_render_settings(): void
{
	if (!current_user_can('manage_options')) {
		return;
	}
	$settings = verifyistic_connector_settings();
	?>
	<div class="wrap">
		<h1><?php esc_html_e('Verifyistic Connector', 'verifyistic-connector'); ?></h1>
		<form method="post" action="options.php">
			<?php settings_fields('verifyistic_connector'); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="vfc-mode"><?php esc_html_e('Mode', 'verifyistic-connector'); ?></label></th>
					<td>
						<select id="vfc-mode" name="<?php echo esc_attr(VERIFYISTIC_CONNECTOR_OPTION); ?>[mode]">
							<option value="cloud" <?php selected('cloud', $settings['mode']); ?>><?php esc_html_e('Verifyistic Cloud', 'verifyistic-connector'); ?></option>
							<option value="self_hosted" <?php selected('self_hosted', $settings['mode']); ?>><?php esc_html_e('Self-Hosted endpoint', 'verifyistic-connector'); ?></option>
						</select>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="vfc-base-url"><?php esc_html_e('API base URL', 'verifyistic-connector'); ?></label></th>
					<td><input id="vfc-base-url" type="url" class="regular-text" name="<?php echo esc_attr(VERIFYISTIC_CONNECTOR_OPTION); ?>[base_url]" value="<?php echo esc_attr($settings['base_url']); ?>" /></td>
				</tr>
				<tr>
					<th scope="row"><label for="vfc-api-key"><?php esc_html_e('Site API key', 'verifyistic-connector'); ?></label></th>
					<td>
						<input id="vfc-api-key" type="password" class="regular-text" name="<?php echo esc_attr(VERIFYISTIC_CONNECTOR_OPTION); ?>[api_key]" value="" autocomplete="off" placeholder="<?php echo esc_attr($settings['api_key'] ? '••••••••' . substr($settings['api_key'], -4) : 'vfy_live_…'); ?>" />
						<p class="description"><?php esc_html_e('Use a site-scoped key (restricted to this site). Stored server-side only, never shown to visitors, printed only as a masked hint.', 'verifyistic-connector'); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="vfc-webhook-secret"><?php esc_html_e('Webhook signing secret', 'verifyistic-connector'); ?></label></th>
					<td>
						<input id="vfc-webhook-secret" type="password" class="regular-text" name="<?php echo esc_attr(VERIFYISTIC_CONNECTOR_OPTION); ?>[webhook_secret]" value="" autocomplete="off" placeholder="<?php echo esc_attr($settings['webhook_secret'] ? '••••••••' : ''); ?>" />
						<p class="description"><?php esc_html_e('From the Verifyistic dashboard — the receiver validates Verifyistic-Signature (HMAC-SHA256) and rejects replays.', 'verifyistic-connector'); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="vfc-site-id"><?php esc_html_e('Site ID', 'verifyistic-connector'); ?></label></th>
					<td><input id="vfc-site-id" type="text" class="regular-text" name="<?php echo esc_attr(VERIFYISTIC_CONNECTOR_OPTION); ?>[site_id]" value="<?php echo esc_attr($settings['site_id']); ?>" /></td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
		<h2><?php esc_html_e('Connection test', 'verifyistic-connector'); ?></h2>
		<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
			<input type="hidden" name="action" value="verifyistic_connector_test" />
			<?php wp_nonce_field('verifyistic_connector_test'); ?>
			<?php submit_button(__('Test connection', 'verifyistic-connector'), 'secondary', 'submit', false); ?>
		</form>
		<p>
			<strong><?php esc_html_e('Webhook receiver URL', 'verifyistic-connector'); ?>:</strong>
			<code><?php echo esc_html(rest_url('verifyistic-connector/v1/webhook')); ?></code>
		</p>
	</div>
	<?php
}

add_action('admin_post_verifyistic_connector_test', function () {
	if (!current_user_can('manage_options')) {
		wp_die(esc_html__('Insufficient permissions.', 'verifyistic-connector'));
	}
	check_admin_referer('verifyistic_connector_test');
	$result = verifyistic_connector_api_request('GET', '/organization');
	if (is_wp_error($result)) {
		$redirect = add_query_arg('vfc_test', 'error', wp_get_referer() ?: admin_url('options-general.php?page=verifyistic-connector'));
		wp_safe_redirect($redirect);
		exit;
	}
	$redirect = add_query_arg(
		array('vfc_test' => 'ok', 'vfc_org' => isset($result['name']) ? rawurlencode((string) $result['name']) : ''),
		wp_get_referer() ?: admin_url('options-general.php?page=verifyistic-connector')
	);
	wp_safe_redirect($redirect);
	exit;
});

add_action('admin_notices', function () {
	if (!isset($_GET['vfc_test']) || !current_user_can('manage_options')) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		return;
	}
	if ('ok' === $_GET['vfc_test']) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		$org = isset($_GET['vfc_org']) ? sanitize_text_field(wp_unslash((string) $_GET['vfc_org'])) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		printf('<div class="notice notice-success"><p>%s</p></div>', esc_html(sprintf(/* translators: %s: organization name */ __('Connected to Verifyistic organization “%s”.', 'verifyistic-connector'), $org)));
		return;
	}
	printf('<div class="notice notice-error"><p>%s</p></div>', esc_html__('Connection test failed — check the API key and base URL.', 'verifyistic-connector'));
});

/* --------------------------------------------------------------------------
 * Webhook receiver (doc 10 §6): HMAC + replay window + event dedupe
 * ------------------------------------------------------------------------ */

add_action('rest_api_init', function () {
	register_rest_route('verifyistic-connector/v1', '/webhook', array(
		'methods'             => 'POST',
		'permission_callback' => '__return_true', // authenticated by HMAC below
		'callback'            => 'verifyistic_connector_handle_webhook',
	));
});

/**
 * @param WP_REST_Request $request
 * @return WP_REST_Response|WP_Error
 */
function verifyistic_connector_handle_webhook($request)
{
	$settings = verifyistic_connector_settings();
	if ('' === $settings['webhook_secret']) {
		return new WP_Error('verifyistic_webhook', __('Webhook secret not configured.', 'verifyistic-connector'), array('status' => 503));
	}
	$body = (string) $request->get_body();
	$timestamp = (string) $request->get_header('verifyistic-timestamp');
	$signature = (string) $request->get_header('verifyistic-signature');

	// Replay window: 10 minutes (doc 05 §5).
	if ('' === $timestamp || abs(time() - (int) $timestamp) > 600) {
		return new WP_Error('verifyistic_webhook', __('Stale webhook timestamp.', 'verifyistic-connector'), array('status' => 400));
	}
	$expected = 'v1=' . hash_hmac('sha256', $timestamp . '.' . $body, $settings['webhook_secret']);
	if (!is_string($signature) || '' === $signature || !hash_equals($expected, $signature)) {
		return new WP_Error('verifyistic_webhook', __('Invalid webhook signature.', 'verifyistic-connector'), array('status' => 401));
	}

	$event = json_decode($body, true);
	if (!is_array($event) || !isset($event['event'], $event['data']) || !is_array($event['data'])) {
		return new WP_Error('verifyistic_webhook', __('Malformed webhook payload.', 'verifyistic-connector'), array('status' => 400));
	}
	$event_id = isset($event['event_id']) ? sanitize_text_field((string) $event['event_id']) : '';
	if ('' === $event_id) {
		return new WP_Error('verifyistic_webhook', __('Webhook event id missing.', 'verifyistic-connector'), array('status' => 400));
	}

	// Dedupe by event id (doc 10 §6): a repeated delivery is acknowledged, not re-processed.
	$dedupe_key = 'vfc_event_' . md5($event_id);
	if (get_transient($dedupe_key)) {
		return new WP_REST_Response(array('received' => true, 'duplicate' => true), 200);
	}
	set_transient($dedupe_key, 1, DAY_IN_SECONDS);

	$data = $event['data'];
	$document_id = isset($data['document_id']) ? sanitize_text_field((string) $data['document_id']) : '';
	$session_id = isset($data['session_id']) ? sanitize_text_field((string) $data['session_id']) : '';

	switch ($event['event']) {
		case 'document.generated':
			if ('' !== $session_id) {
				update_option('vfc_last_status_' . md5($session_id), 'completed', false);
			}
			/**
			 * Fires when Verifyistic reports a signed document was generated.
			 * Like all connector hooks, carries only safe cloud ids — no PII.
			 *
			 * @param string $document_id Cloud document UUID.
			 * @param string $session_id  Cloud signing session UUID.
			 */
			do_action('verifyistic_document_completed', $document_id, $session_id);
			break;
		case 'signing_session.completed':
			if ('' !== $session_id) {
				update_option('vfc_last_status_' . md5($session_id), 'completed', false);
			}
			do_action('verifyistic_status_changed', $session_id, 'completed');
			break;
		case 'signing_session.declined':
			if ('' !== $session_id) {
				update_option('vfc_last_status_' . md5($session_id), 'declined', false);
			}
			do_action('verifyistic_status_changed', $session_id, 'declined');
			break;
	}

	return new WP_REST_Response(array('received' => true), 200);
}

/* --------------------------------------------------------------------------
 * User waiver requests + status (admin-initiated; no front-end PII flows)
 * ------------------------------------------------------------------------ */

add_action('edit_user_profile', 'verifyistic_connector_user_field');
add_action('show_user_profile', 'verifyistic_connector_user_field');
function verifyistic_connector_user_field($user): void
{
	if (!current_user_can('edit_user', $user->ID)) {
		return;
	}
	$session_id = get_user_meta($user->ID, 'verifyistic_session_id', true);
	$document_id = get_user_meta($user->ID, 'verifyistic_document_id', true);
	?>
	<h2><?php esc_html_e('Verifyistic waiver', 'verifyistic-connector'); ?></h2>
	<table class="form-table" role="presentation">
		<tr>
			<th><?php esc_html_e('Status', 'verifyistic-connector'); ?></th>
			<td>
				<?php
				$labels = array(
					'none'      => __('No waiver requested', 'verifyistic-connector'),
					'sent'      => __('Signing request sent', 'verifyistic-connector'),
					'completed' => __('Waiver completed', 'verifyistic-connector'),
					'declined'  => __('Signing declined', 'verifyistic-connector'),
				);
				$status = $document_id ? 'completed' : ('' !== $session_id ? (string) get_option('vfc_last_status_' . md5($session_id), 'sent') : 'none');
				echo esc_html($labels[$status] ?? $status);
				?>
			</td>
		</tr>
		<?php if ('' !== $session_id) : ?>
		<tr>
			<th><?php esc_html_e('Signing link (send to the customer)', 'verifyistic-connector'); ?></th>
			<td><code><?php echo esc_html(get_user_meta($user->ID, 'verifyistic_signer_url', true)); ?></code></td>
		</tr>
		<?php endif; ?>
	</table>
	<?php if ('' === $document_id) : ?>
	<form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
		<input type="hidden" name="action" value="verifyistic_connector_send_waiver" />
		<input type="hidden" name="user_id" value="<?php echo esc_attr((string) $user->ID); ?>" />
		<?php wp_nonce_field('verifyistic_connector_send_waiver'); ?>
		<?php submit_button(__('Send waiver request', 'verifyistic-connector'), 'secondary', 'submit', false); ?>
	</form>
	<?php endif; ?>
	<?php
}

add_action('admin_post_verifyistic_connector_send_waiver', function () {
	$user_id = isset($_POST['user_id']) ? absint((string) $_POST['user_id']) : 0;
	if ($user_id < 1 || !current_user_can('edit_user', $user_id)) {
		wp_die(esc_html__('Insufficient permissions.', 'verifyistic-connector'));
	}
	check_admin_referer('verifyistic_connector_send_waiver');

	$user = get_userdata($user_id);
	if (!$user || '' === (string) $user->user_email) {
		wp_die(esc_html__('User has no email — Verifyistic needs an email for the signing invitation.', 'verifyistic-connector'));
	}

	// Create (or find) the cloud customer, then the signing session — both idempotent.
	$customer_result = verifyistic_connector_api_request('POST', '/customers', array(
		'first_name' => $user->first_name ?: $user->display_name,
		'last_name'  => $user->last_name ?: '—',
		'email'      => $user->user_email,
	), 'wp-user-' . $user_id . '-customer');
	if (is_wp_error($customer_result)) {
		wp_die(esc_html($customer_result->get_error_message()));
	}
	$customer_id = isset($customer_result['id']) ? sanitize_text_field((string) $customer_result['id']) : '';
	if ('' === $customer_id) {
		wp_die(esc_html__('Unexpected Verifyistic response: customer id missing.', 'verifyistic-connector'));
	}

	$settings = verifyistic_connector_settings();
	$session_body = array(
		'template_id' => '', // set below
		'customer_id' => $customer_id,
		'delivery_method' => 'email',
	);
	// The connector sends waivers from the template configured for this site.
	$template_id = (string) get_option('verifyistic_connector_template_id', '');
	if ('' === $template_id) {
		wp_die(esc_html__('Set verifyistic_connector_template_id (option) to a published template id first.', 'verifyistic-connector'));
	}
	$session_body['template_id'] = $template_id;
	if ('' !== $settings['site_id']) {
		$session_body['site_id'] = $settings['site_id'];
	}

	$session = verifyistic_connector_api_request('POST', '/signing-sessions', $session_body, 'wp-user-' . $user_id . '-session');
	if (is_wp_error($session)) {
		wp_die(esc_html($session->get_error_message()));
	}
	$session_id = isset($session['id']) ? sanitize_text_field((string) $session['id']) : '';
	$signer_url = isset($session['signer_url']) ? esc_url_raw((string) $session['signer_url']) : '';

	update_user_meta($user_id, 'verifyistic_customer_id', $customer_id);
	update_user_meta($user_id, 'verifyistic_session_id', $session_id);
	update_user_meta($user_id, 'verifyistic_signer_url', $signer_url);

	wp_safe_redirect(add_query_arg('vfc_sent', '1', get_edit_user_link($user_id)));
	exit;
});

/* --------------------------------------------------------------------------
 * Status shortcode: [verifyistic_waiver_status]
 * ------------------------------------------------------------------------ */

add_shortcode('verifyistic_waiver_status', function ($atts) {
	$atts = shortcode_atts(array('user_id' => get_current_user_id()), $atts, 'verifyistic_waiver_status');
	$user_id = absint((string) $atts['user_id']);
	if ($user_id < 1) {
		return '';
	}
	$session_id = (string) get_user_meta($user_id, 'verifyistic_session_id', true);
	$document_id = (string) get_user_meta($user_id, 'verifyistic_document_id', true);
	if ('' !== $document_id) {
		return '<span class="verifyistic-status verifyistic-status-completed">' . esc_html__('Waiver on file', 'verifyistic-connector') . '</span>';
	}
	if ('' === $session_id) {
		return '<span class="verifyistic-status verifyistic-status-none">' . esc_html__('No waiver yet', 'verifyistic-connector') . '</span>';
	}
	$status = (string) get_option('vfc_last_status_' . md5($session_id), 'sent');
	$labels = array(
		'sent'     => __('Waiver request sent', 'verifyistic-connector'),
		'completed' => __('Waiver on file', 'verifyistic-connector'),
		'declined' => __('Waiver declined', 'verifyistic-connector'),
	);
	return '<span class="verifyistic-status verifyistic-status-' . esc_attr($status) . '">' . esc_html($labels[$status] ?? $status) . '</span>';
});

/* --------------------------------------------------------------------------
 * WooCommerce: block fulfillment steps when a required waiver is missing (doc 10 §7)
 * ------------------------------------------------------------------------ */

add_action('woocommerce_check_cart_items', function () {
	if (!function_exists('WC') || !WC()->cart) {
		return;
	}
	$required_categories = (array) get_option('verifyistic_connector_woo_categories', array());
	$required_categories = array_map('absint', $required_categories);
	if (array() === $required_categories) {
		return;
	}
	foreach (WC()->cart->get_cart() as $item) {
		$product_id = $item['product_id'] ?? 0;
		if (has_term($required_categories, 'product_cat', $product_id)) {
			$user_id = get_current_user_id();
			$document_id = $user_id > 0 ? (string) get_user_meta($user_id, 'verifyistic_document_id', true) : '';
			if ('' === $document_id) {
				wc_add_notice(__('A signed waiver is required for items in this cart. Please complete your waiver first.', 'verifyistic-connector'), 'error');
				return;
			}
		}
	}
});
