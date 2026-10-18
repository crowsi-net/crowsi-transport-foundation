use crate::{Error, Result, response, target};
use reqwest::{Url, blocking::Client, header::HeaderValue};
use std::time::{Duration, Instant};
use zeroize::Zeroizing;
pub struct HttpsRead {
    origin: Url,
    client: Client,
    bearer: HeaderValue,
    deadline: Instant,
    remaining: u8,
}
pub(crate) fn builder() -> reqwest::blocking::ClientBuilder {
    Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(5))
}
impl HttpsRead {
    pub fn new(origin: &str, token: &str, timeout: Duration, requests: u8) -> Result<Self> {
        Self::create(
            origin,
            token,
            timeout,
            requests,
            builder().build().map_err(|_| Error::Transport)?,
        )
    }
    pub(crate) fn create(
        origin: &str,
        token: &str,
        timeout: Duration,
        requests: u8,
        client: Client,
    ) -> Result<Self> {
        if timeout < Duration::from_millis(50)
            || timeout > Duration::from_secs(40)
            || !(1..=32).contains(&requests)
        {
            return Err(Error::Configuration);
        }
        if token.is_empty()
            || token.len() > 16384
            || !token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._~+/-=".contains(&b))
        {
            return Err(Error::Credential);
        }
        let mut bearer =
            HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| Error::Credential)?;
        bearer.set_sensitive(true);
        Ok(Self {
            origin: target::origin(origin)?,
            client,
            bearer,
            deadline: Instant::now() + timeout,
            remaining: requests,
        })
    }
    /// One explicit GET. No redirects, inherited proxies, retries, pagination or API discovery.
    pub fn get(
        &mut self,
        url: &str,
        headers: &[(&str, &str)],
        maximum: usize,
    ) -> Result<Zeroizing<Vec<u8>>> {
        if maximum == 0 || maximum > 1024 * 1024 {
            return Err(Error::Configuration);
        }
        let url = target::target(&self.origin, url)?;
        let headers = target::headers(headers)?;
        let timeout = self
            .deadline
            .checked_duration_since(Instant::now())
            .ok_or(Error::Budget)?;
        if self.remaining == 0 {
            return Err(Error::Budget);
        }
        self.remaining -= 1;
        let response = self
            .client
            .get(url)
            .headers(headers)
            .header("authorization", self.bearer.clone())
            .timeout(timeout)
            .send()
            .map_err(|_| Error::Transport)?;
        response::collect(response, maximum)
    }
}
#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
