-- Users (customers of the WebGuard service)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    uflow VARCHAR(255) UNIQUE NOT NULL,
    tg_user VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    active SMALLINT DEFAULT 2, -- 1 = active, 0 = inactive, 2 = pending activation / banned
    start_sub TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    end_sub TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_users_uflow ON users(uflow);

-- Visits log
CREATE TABLE IF NOT EXISTS visits (
    id SERIAL PRIMARY KEY,
    uflow VARCHAR(255) REFERENCES users(uflow) ON DELETE CASCADE,
    date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip VARCHAR(45) NOT NULL,
    country VARCHAR(10) DEFAULT 'N/A',
    hostname VARCHAR(255) DEFAULT 'N/A',
    isp VARCHAR(255) DEFAULT 'N/A',
    system VARCHAR(100) DEFAULT 'Unknown OS',
    browser VARCHAR(100) DEFAULT 'Unknown Browser',
    referee TEXT DEFAULT '',
    isbot SMALLINT DEFAULT 1, -- 1 = human, 0 = bot
    source VARCHAR(255) DEFAULT '',
    block_reason VARCHAR(255) DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_visits_uflow ON visits(uflow);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(date);

-- Bad IP blacklist
CREATE TABLE IF NOT EXISTS bad_ip (
    id SERIAL PRIMARY KEY,
    bad_ip VARCHAR(255) UNIQUE NOT NULL
);

-- Blacklisted hostname patterns
CREATE TABLE IF NOT EXISTS hostname (
    id SERIAL PRIMARY KEY,
    hostname VARCHAR(255) UNIQUE NOT NULL
);

-- Blacklisted ISP patterns
CREATE TABLE IF NOT EXISTS isp (
    id SERIAL PRIMARY KEY,
    isp VARCHAR(255) UNIQUE NOT NULL
);

-- Allowed operating systems
CREATE TABLE IF NOT EXISTS system (
    id SERIAL PRIMARY KEY,
    system VARCHAR(100) UNIQUE NOT NULL
);

-- User-specific country whitelist & OS whitelist
CREATE TABLE IF NOT EXISTS user_settings (
    id SERIAL PRIMARY KEY,
    uflow VARCHAR(255) REFERENCES users(uflow) ON DELETE CASCADE UNIQUE,
    countries TEXT, -- Comma-separated list of allowed country codes (e.g. 'US, FR, GB')
    systems TEXT -- Comma-separated list of allowed operating systems (e.g. 'Windows 10, Mac OS X')
);

-- Generated client snippet parts (standard templates)
CREATE TABLE IF NOT EXISTS code (
    id INT PRIMARY KEY DEFAULT 1,
    tds_p1 TEXT NOT NULL,
    tds_p2 TEXT NOT NULL
);

-- User-configured IP intelligence API providers
CREATE TABLE IF NOT EXISTS ip_providers (
    id SERIAL PRIMARY KEY,
    uflow VARCHAR(255) REFERENCES users(uflow) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    url_template VARCHAR(500) NOT NULL,
    api_key VARCHAR(255) DEFAULT '',
    country_field VARCHAR(100) NOT NULL,
    isp_field VARCHAR(100) NOT NULL,
    enabled BOOLEAN DEFAULT true,
    sort_order INT DEFAULT 0,
    UNIQUE(uflow, name)
);

-- Seed basic systems
INSERT INTO system (system) VALUES 
('Windows 10'), ('Windows 8.1'), ('Windows 8'), ('Windows 7'), 
('Mac OS X'), ('iPhone'), ('iPad'), ('Android'), ('Mobile'), ('Linux')
ON CONFLICT (system) DO NOTHING;

-- Seed default code snippets
INSERT INTO code (id, tds_p1, tds_p2) VALUES (
    1,
    '<?php
if (!function_exists(''trueip'')) {
    function trueip() {
        if (!empty($_SERVER[''HTTP_CF_CONNECTING_IP''])) return $_SERVER[''HTTP_CF_CONNECTING_IP''];
        if (!empty($_SERVER[''HTTP_X_FORWARDED_FOR''])) return explode('','', $_SERVER[''HTTP_X_FORWARDED_FOR''])[0];
        if (!empty($_SERVER[''HTTP_CLIENT_IP''])) return $_SERVER[''HTTP_CLIENT_IP''];
        return $_SERVER[''REMOTE_ADDR''];
    }
}
$ip = trueip();
$ref = $_SERVER[''HTTP_REFERER''] ?? '''';
$ua = $_SERVER[''HTTP_USER_AGENT''] ?? '''';
$data = !empty($_SERVER[''QUERY_STRING'']) ? urlencode($_SERVER[''QUERY_STRING'']) : '''';
$url = ''__API_URL__detect'';
$ch = curl_init();
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, FALSE);
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 5);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query([
    ''fd'' => ''',
    ''',
    ''ip'' => $ip,
    ''ref'' => $ref,
    ''ua'' => $ua,
    ''data'' => $data
]));
$ifbot = curl_exec($ch);
curl_close($ch);
if ($ifbot !== ''1'') {
    header_remove();
    header(''Connection: close'');
    header(''HTTP/1.1 404 Not Found'');
    die();
}
?>'
) ON CONFLICT (id) DO NOTHING;
