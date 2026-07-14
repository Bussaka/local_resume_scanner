import re
from pypdf import PdfReader

def clean_extracted_text(text: str) -> str:
    """
    Cleans raw extracted text by removing non-ASCII characters,
    normalizing bullet points, and cleaning up excessive whitespaces.
    """
    # 1. Normalize bullet points and decorative symbols to simple dashes
    text = re.sub(r'[\u2022\u2023\u25E6\u2043\u2219]', '-', text)
    
    # 2. Convert multiple spaces and tabs to a single space
    text = re.sub(r'[ \t]+', ' ', text)
    
    # 3. Prevent huge gaps of blank lines (keep max 2 newlines consecutively)
    text = re.sub(r'\n\s*\n', '\n\n', text)
    
    return text.strip()

def parse_pdf_to_text(pdf_path: str) -> str:
    """
    Extracts layout-aware, clean plain text from a PDF file.
    Uses layout mode to handle multi-column formats gracefully.
    """
    try:
        reader = PdfReader(pdf_path)
        raw_text_list = []
        
        for page in reader.pages:
            # extraction_mode="layout" attempts to maintain structural blocks 
            # and columns instead of doing naive horizontal line reading.
            page_text = page.extract_text(extraction_mode="layout")
            if page_text:
                raw_text_list.append(page_text)
                
        full_text = "\n--- New Page ---\n".join(raw_text_list)
        return clean_extracted_text(full_text)
        
    except Exception as e:
        raise RuntimeError(f"Failed to parse PDF at {pdf_path}: {str(e)}")