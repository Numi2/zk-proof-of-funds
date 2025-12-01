//! QR code generation for Zcash payment URIs
//! Numan Thabit
//! Generate QR codes that can be scanned by mobile wallets.

use crate::{PaymentRequirements, zatoshis_to_zec};

#[cfg(feature = "qrcode")]
use crate::{X402Error, X402Result};

/// Generate a Zcash payment URI from requirements
pub fn payment_uri(requirements: &PaymentRequirements) -> String {
    let zec = zatoshis_to_zec(requirements.amount_zatoshis);
    
    let mut uri = format!("zcash:{}?amount={:.8}", requirements.address, zec);
    
    // Add memo if available
    if let Some(ref memo) = requirements.memo {
        uri.push_str(&format!("&memo={}", urlencoding_encode(memo)));
    } else if let Some(ref payment_id) = requirements.payment_id {
        // Use payment_id as memo for tracking
        uri.push_str(&format!("&memo={}", urlencoding_encode(&format!("x402:{}", payment_id))));
    }
    
    // Add message/description if available
    if let Some(ref desc) = requirements.description {
        uri.push_str(&format!("&message={}", urlencoding_encode(desc)));
    }
    
    uri
}

/// Simple URL encoding for memo/message fields
fn urlencoding_encode(s: &str) -> String {
    let mut result = String::new();
    for c in s.chars() {
        match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => {
                result.push(c);
            }
            ' ' => result.push_str("%20"),
            _ => {
                for byte in c.to_string().as_bytes() {
                    result.push_str(&format!("%{:02X}", byte));
                }
            }
        }
    }
    result
}

#[cfg(feature = "qrcode")]
mod qr_impl {
    use super::*;
    use qrcode::QrCode;
    use image::{Luma, ImageBuffer};

    /// QR code output format
    #[derive(Debug, Clone, Copy)]
    pub enum QrFormat {
        /// PNG image bytes
        Png,
        /// SVG string
        Svg,
        /// Unicode art for terminal display
        Terminal,
    }

    /// Options for QR code generation
    #[derive(Debug, Clone)]
    pub struct QrOptions {
        /// Image size in pixels (for PNG)
        pub size: u32,
        /// Quiet zone (margin) in modules
        pub quiet_zone: u32,
        /// Output format
        pub format: QrFormat,
        /// Foreground color (hex, e.g., "#000000")
        pub fg_color: String,
        /// Background color (hex, e.g., "#FFFFFF")
        pub bg_color: String,
    }

    impl Default for QrOptions {
        fn default() -> Self {
            Self {
                size: 256,
                quiet_zone: 2,
                format: QrFormat::Png,
                fg_color: "#000000".to_string(),
                bg_color: "#FFFFFF".to_string(),
            }
        }
    }

    impl QrOptions {
        /// Create options for PNG output
        pub fn png(size: u32) -> Self {
            Self {
                size,
                format: QrFormat::Png,
                ..Self::default()
            }
        }

        /// Create options for SVG output
        pub fn svg() -> Self {
            Self {
                format: QrFormat::Svg,
                ..Self::default()
            }
        }

        /// Create options for terminal output
        pub fn terminal() -> Self {
            Self {
                format: QrFormat::Terminal,
                ..Self::default()
            }
        }
    }

    /// Generate a QR code for payment
    pub fn generate_qr(requirements: &PaymentRequirements, options: &QrOptions) -> X402Result<Vec<u8>> {
        let uri = payment_uri(requirements);
        generate_qr_from_data(&uri, options)
    }

    /// Generate a QR code from arbitrary data
    pub fn generate_qr_from_data(data: &str, options: &QrOptions) -> X402Result<Vec<u8>> {
        let code = QrCode::new(data.as_bytes())
            .map_err(|e| X402Error::InternalError(format!("QR generation failed: {}", e)))?;

        match options.format {
            QrFormat::Png => generate_png(&code, options),
            QrFormat::Svg => Ok(generate_svg(&code, options).into_bytes()),
            QrFormat::Terminal => Ok(generate_terminal(&code).into_bytes()),
        }
    }

    fn generate_png(code: &QrCode, options: &QrOptions) -> X402Result<Vec<u8>> {
        let image = code.render::<Luma<u8>>()
            .quiet_zone(options.quiet_zone > 0)
            .min_dimensions(options.size, options.size)
            .build();

        let mut bytes = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut bytes);
        
        image::ImageEncoder::write_image(
            encoder,
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::L8,
        ).map_err(|e| X402Error::InternalError(format!("PNG encoding failed: {}", e)))?;

        Ok(bytes)
    }

    fn generate_svg(code: &QrCode, options: &QrOptions) -> String {
        code.render()
            .quiet_zone(options.quiet_zone > 0)
            .dark_color(qrcode::render::svg::Color(&options.fg_color))
            .light_color(qrcode::render::svg::Color(&options.bg_color))
            .build()
    }

    fn generate_terminal(code: &QrCode) -> String {
        code.render::<char>()
            .quiet_zone(true)
            .module_dimensions(2, 1)
            .build()
    }

    /// Generate a QR code as a data URI for embedding in HTML
    pub fn generate_data_uri(requirements: &PaymentRequirements) -> X402Result<String> {
        let options = QrOptions::png(256);
        let png_bytes = generate_qr(requirements, &options)?;
        
        use base64::{Engine, engine::general_purpose::STANDARD};
        let b64 = STANDARD.encode(&png_bytes);
        
        Ok(format!("data:image/png;base64,{}", b64))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_qr_generation() {
            let requirements = PaymentRequirements::new("zs1test".to_string(), 100_000);
            
            // PNG
            let png = generate_qr(&requirements, &QrOptions::png(128)).unwrap();
            assert!(!png.is_empty());
            assert!(png.starts_with(&[0x89, 0x50, 0x4E, 0x47])); // PNG magic bytes
            
            // SVG
            let svg = generate_qr(&requirements, &QrOptions::svg()).unwrap();
            let svg_str = String::from_utf8(svg).unwrap();
            assert!(svg_str.contains("<svg"));
            
            // Terminal
            let term = generate_qr(&requirements, &QrOptions::terminal()).unwrap();
            let term_str = String::from_utf8(term).unwrap();
            assert!(!term_str.is_empty());
        }

        #[test]
        fn test_data_uri() {
            let requirements = PaymentRequirements::new("zs1test".to_string(), 100_000);
            let uri = generate_data_uri(&requirements).unwrap();
            
            assert!(uri.starts_with("data:image/png;base64,"));
        }
    }
}

#[cfg(feature = "qrcode")]
pub use qr_impl::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_payment_uri_basic() {
        let requirements = PaymentRequirements::new("zs1testaddress".to_string(), 100_000_000);
        let uri = payment_uri(&requirements);
        
        assert!(uri.starts_with("zcash:zs1testaddress"));
        assert!(uri.contains("amount=1.00000000"));
    }

    #[test]
    fn test_payment_uri_with_memo() {
        let mut requirements = PaymentRequirements::new("zs1test".to_string(), 50_000_000);
        requirements.memo = Some("Test payment".to_string());
        requirements.description = Some("API access".to_string());
        
        let uri = payment_uri(&requirements);
        
        assert!(uri.contains("memo=Test%20payment"));
        assert!(uri.contains("message=API%20access"));
    }

    #[test]
    fn test_payment_uri_with_payment_id() {
        let mut requirements = PaymentRequirements::new("zs1test".to_string(), 100_000);
        requirements.payment_id = Some("pay_abc123".to_string());
        
        let uri = payment_uri(&requirements);
        
        assert!(uri.contains("memo=x402%3Apay_abc123"));
    }
}

