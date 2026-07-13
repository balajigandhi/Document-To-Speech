import re
from bs4 import BeautifulSoup


def clean_with_regex(text: str) -> str:
    """
    Clean text using regular expressions.

    This function removes:
        - URLs
        - emails
        - special characters
        - extra spaces

    Examples:
        >>> clean_with_regex("\xa0Hello,   world! http://example.com")
        "Hello, world!"

    Args:
        text (str): The text to clean.

    Returns:
        str: The cleaned text.
    """
    text = re.sub(
        r"http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\(\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+",
        "",
        text,
    )
    text = re.sub(r"[\w\.-]+@[\w\.-]+\.[\w]+", "", text)
    text = re.sub(r"[-–—]", " ", text)  # hyphens/dashes to space before stripping
    text = re.sub(r'[^a-zA-Z0-9\s.,!?;:"\']', "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def clean_html(text: str) -> str:
    """Clean HTML text.

    This function removes:
        - scripts
        - styles
        - links
        - meta tags

    In addition, it calls [clean_with_regex][document_to_speech.preprocessing.data_cleaners.clean_with_regex].

    Examples:
        >>> clean_html("<html><body><p>Hello,  world!  </p></body></html>"")
        "Hello, world!"

    Args:
        text (str): The HTML text to clean.

    Returns:
        str: The cleaned text.
    """
    soup = BeautifulSoup(text, "html.parser")
    for tag in soup(["script", "style", "link", "meta", "nav", "header", "footer"]):
        tag.decompose()
    # Pad inline elements with spaces so adjacent spans don't merge words
    for tag in soup.find_all(["span", "strong", "em", "b", "i", "a", "code", "mark"]):
        if tag.string:
            tag.string.replace_with(" " + tag.string + " ")
    # Insert a pause marker after block elements so TTS pauses at section boundaries.
    # A period followed by newlines causes the sentence splitter to break here and
    # Kokoro to produce a natural breath between headings/paragraphs/list items.
    for tag in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th", "blockquote", "pre", "div"]):
        tag.append(". ")
    text = soup.get_text(separator="\n")
    # Collapse multiple spaces/newlines but keep sentence-ending punctuation
    text = re.sub(r" {2,}", " ", text)
    text = re.sub(r"\n+", " ", text)
    return clean_with_regex(text)


def clean_markdown(text: str) -> str:
    """Clean Markdown text.

    This function removes:
        - markdown images

    In addition, it calls [clean_with_regex][document_to_speech.preprocessing.data_cleaners.clean_with_regex].

    Examples:
        >>> clean_markdown('# Title   with image ![alt text](image.jpg "Image Title")')
        "Title with image"

    Args:
        text (str): The Markdown text to clean.

    Returns:
        str: The cleaned text.
    """
    text = re.sub(r'!\[.*?\]\(.*?(".*?")?\)', "", text)

    return clean_with_regex(text)
