#!/bin/bash
# Install PHP with Laravel extensions, Composer, SQLite, and Xdebug
# This script is called conditionally during Docker build when PHP_VERSION is set
#
# Usage: ./install-php.sh <php-version>
# Example: ./install-php.sh 8.3

set -e

PHP_VERSION="${1}"

if [ -z "$PHP_VERSION" ]; then
    echo "PHP_VERSION not specified, skipping PHP installation"
    exit 0
fi

echo "Installing PHP ${PHP_VERSION} with Laravel extensions..."

# Install prerequisites for Sury repository
apt-get update
apt-get install -y --no-install-recommends gnupg lsb-release ca-certificates

# Add Sury PHP repository (provides multiple PHP versions for Debian)
curl -sSL https://packages.sury.org/php/README.txt | bash -x

# Install PHP and extensions required by Laravel
apt-get update
apt-get install -y --no-install-recommends \
    "php${PHP_VERSION}" \
    "php${PHP_VERSION}-cli" \
    "php${PHP_VERSION}-common" \
    "php${PHP_VERSION}-curl" \
    "php${PHP_VERSION}-mbstring" \
    "php${PHP_VERSION}-xml" \
    "php${PHP_VERSION}-zip" \
    "php${PHP_VERSION}-bcmath" \
    "php${PHP_VERSION}-intl" \
    "php${PHP_VERSION}-readline" \
    "php${PHP_VERSION}-sqlite3" \
    "php${PHP_VERSION}-pdo" \
    "php${PHP_VERSION}-tokenizer" \
    "php${PHP_VERSION}-fileinfo" \
    "php${PHP_VERSION}-xdebug" \
    sqlite3 \
    unzip

# Clean up apt cache
rm -rf /var/lib/apt/lists/*

# Install Composer globally
curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

# Verify installations
echo "=== PHP Installation Complete ==="
php --version
composer --version
sqlite3 --version
echo "Xdebug: $(php -m | grep -i xdebug || echo 'not found')"
