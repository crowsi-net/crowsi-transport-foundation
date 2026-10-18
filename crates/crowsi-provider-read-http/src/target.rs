use crate::{Error, Result};
use reqwest::{
    Url,
    header::{HeaderMap, HeaderName, HeaderValue},
};
pub(crate) fn origin(input: &str) -> Result<Url> {
    let url = Url::parse(input).map_err(|_| Error::Configuration)?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::Configuration);
    }
    Ok(url)
}
pub(crate) fn target(origin: &Url, input: &str) -> Result<Url> {
    let url = Url::parse(input).map_err(|_| Error::Target)?;
    if url.origin() != origin.origin()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::Target);
    }
    Ok(url)
}
pub(crate) fn headers(input: &[(&str, &str)]) -> Result<HeaderMap> {
    if input.len() > 8 {
        return Err(Error::Target);
    }
    let mut headers = HeaderMap::new();
    for (key, value) in input {
        let name = HeaderName::from_bytes(key.as_bytes()).map_err(|_| Error::Target)?;
        if !(name == "accept"
            || (name.as_str().starts_with("x-") && name.as_str().ends_with("-version")))
            || value.len() > 256
            || headers.contains_key(&name)
        {
            return Err(Error::Target);
        }
        let value = HeaderValue::from_str(value).map_err(|_| Error::Target)?;
        headers.insert(name, value);
    }
    Ok(headers)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origin_and_target_reject_userinfo_fragments_plaintext_and_cross_origin() {
        for u in [
            "http://example.invalid",
            "https://u@example.invalid",
            "https://example.invalid/path",
            "https://example.invalid?x=y",
        ] {
            assert!(origin(u).is_err());
        }
        let o = origin("https://example.invalid").unwrap();
        for u in [
            "https://other.invalid/a",
            "https://example.invalid:444/a",
            "https://u@example.invalid/a",
            "https://example.invalid/a#f",
            "http://example.invalid/a",
        ] {
            assert!(target(&o, u).is_err());
        }
        assert!(target(&o, "https://example.invalid/a?q=opaque").is_ok());
    }
    #[test]
    fn credentials_proxy_and_host_headers_cannot_be_replaced() {
        for name in [
            "Authorization",
            "X-HTTP-Method-Override",
            "Host",
            "Cookie",
            "Proxy-Authorization",
            "Connection",
            "X-HTTP-Method-Override",
        ] {
            assert!(headers(&[(name, "synthetic")]).is_err());
        }
        assert!(headers(&[("X-Example-Version", "1"), ("x-example-version", "2")]).is_err());
        assert!(headers(&[("accept", "bad\r\nvalue")]).is_err());
        assert!(headers(&[("accept", "application/json")]).is_ok());
    }
}
