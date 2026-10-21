export async function readDocument(file) {
  if(file.size>10*1024*1024)throw new Error(`${file.name}: use a file smaller than 10 MB.`);
  let text='';const extension=file.name.toLowerCase().split('.').at(-1);
  if(['txt','md'].includes(extension))text=await file.text();
  else if(extension==='pdf'){
    const pdfjs=await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).href;
    const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useSystemFonts:true});
    try{
      const pdf=await task.promise;
      if(pdf.numPages>60)throw new Error('Please use a PDF with 60 pages or fewer.');
      for(let i=1;i<=pdf.numPages;i++){
        const page=await pdf.getPage(i);const content=await page.getTextContent();
        text+=content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('')+'\n\n';
      }
    }finally{await task.destroy();}
  }else if(extension==='docx'){
    const {unzipSync,strFromU8}=await import('fflate');
    let oversized=false;
    const files=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>{
      if(entry.name!=='word/document.xml')return false;
      if(entry.originalSize>2000000){oversized=true;return false;}return true;
    }});
    if(oversized)throw new Error('The document expands beyond the supported size. Use a shorter document.');
    if(!files['word/document.xml'])throw new Error('This DOCX file has no readable document text.');
    const xml=new DOMParser().parseFromString(strFromU8(files['word/document.xml']),'application/xml');
    if(xml.getElementsByTagName('parsererror').length)throw new Error('The document text could not be read. Try exporting it as a PDF or text file.');
    text=[...xml.getElementsByTagNameNS('*','p')].map(p=>[...p.getElementsByTagNameNS('*','t')].map(t=>t.textContent).join('')).join('\n\n');
  }else throw new Error('Use PDF, DOCX, TXT or Markdown.');
  text=text.replace(/\u0000/g,'').trim();
  if(text.length<20)throw new Error(`${file.name}: no readable text was found. For scanned PDFs, paste the text instead.`);
  if(text.length>80000)throw new Error(`${file.name}: this is too long. Use a shorter document or paste the relevant parts.`);
  return {id:crypto.randomUUID(),title:file.name.slice(0,180),text};
}
